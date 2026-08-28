// lib/gateway.js
// HTTP 网关核心逻辑：纯 request → response，AI 调用可注入，便于测试。
// 路由：
//   GET  /health  → 200 { ok:true, service:'cotrip-ai-analyze' }（匿名）
//   POST /analyze → Bearer 认证 + 输入校验 + AI 调用 + AI JSON 基础校验

const { isAuthorized } = require('./auth');
const { parseJsonBody, validateAnalyzeInput } = require('./request-parser');
const { extractJsonContent, isValidGatewayAnalysis } = require('./ai-response-parser');

function json(status, body) {
  return {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body,
  };
}

/**
 * @param {object} deps
 * @param {{ analyze(input:{rawText:string,context?:object}): Promise<{text:string}> }} deps.aiProvider
 * @param {string} deps.secret COTRIP_AI_GATEWAY_SECRET（来自云函数环境变量）
 * @param {number} [deps.maxBodyBytes]
 * @param {number} [deps.maxRawTextLength]
 */
function createGateway({ aiProvider, secret, maxBodyBytes = 64 * 1024, maxRawTextLength = 1000 }) {
  async function handle({ method, url, headers = {}, bodyText = '' }) {
    if (method === 'GET' && url === '/health') {
      return json(200, { ok: true, service: 'cotrip-ai-analyze' });
    }

    if (method !== 'POST' || url !== '/analyze') {
      return json(404, { ok: false, error: 'NOT_FOUND' });
    }

    if (!isAuthorized(headers.authorization, secret)) {
      return json(401, { ok: false, error: 'UNAUTHORIZED' });
    }

    if (Buffer.byteLength(bodyText) > maxBodyBytes) {
      return json(400, { ok: false, error: 'REQUEST_TOO_LARGE' });
    }

    const parsedBody = parseJsonBody(bodyText);
    if (!parsedBody.ok) {
      return json(400, { ok: false, error: 'INVALID_JSON' });
    }

    const input = validateAnalyzeInput(parsedBody.value, maxRawTextLength);
    if (!input.ok) {
      return json(400, { ok: false, error: input.error });
    }

    let aiResult;
    try {
      aiResult = await aiProvider.analyze(input.value);
    } catch (error) {
      console.error('[cotrip-ai-analyze] provider failure:', error && error.message);
      return json(502, { ok: false, error: 'AI_PROVIDER_FAILURE' });
    }

    let analysis;
    try {
      analysis = extractJsonContent(aiResult && aiResult.text);
    } catch {
      return json(502, { ok: false, error: 'AI_INVALID_RESPONSE' });
    }

    if (!isValidGatewayAnalysis(analysis)) {
      return json(502, { ok: false, error: 'AI_INVALID_RESPONSE' });
    }

    return json(200, { ok: true, analysis });
  }

  return { handle };
}

module.exports = { createGateway };
