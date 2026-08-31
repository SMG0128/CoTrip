// lib/gateway.js
// HTTP 网关核心逻辑：纯 request → response，AI 调用可注入，便于测试。
// 路由：
//   GET  /health     → 200 { ok:true, service:'cotrip-ai-analyze' }（匿名）
//   POST /analyze    → Bearer 认证 + 输入校验 + AI 调用 + AI JSON 基础校验
//   POST /coordinate → Bearer 认证 + 输入校验 + AI 协调建议调用 + JSON 基础校验
//   POST /preprocess | /comment-evaluation | /initial-generation | /trip-update
//                    → AI Trip Pipeline V2 严格 Envelope

const { isAuthorized } = require('./auth');
const {
  parseJsonBody,
  validateAnalyzeInput,
  validateCoordinateInput,
} = require('./request-parser');
const { extractJsonContent, validateGatewayAnalysis } = require('./ai-response-parser');
const {
  parseProposalJson,
  validateCoordinateProposal,
} = require('./coordinate-response-parser');
const {
  parseStrictJsonContent,
  validatePipelineInput,
  validatePipelineEnvelope,
} = require('./pipeline-contract');

const PIPELINE_ROUTES = {
  '/preprocess': 'PREPROCESS',
  '/comment-evaluation': 'COMMENT_EVALUATION',
  '/initial-generation': 'INITIAL_GENERATION',
  '/trip-update': 'TRIP_UPDATE',
};

function json(status, body) {
  return {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body,
  };
}

function authorizedOrUnauthorized(headers, secret) {
  return isAuthorized(headers.authorization, secret);
}

/**
 * @param {object} deps
 * @param {{ analyze(input:{rawText:string,context?:object}): Promise<{text:string}>, coordinate?(input:object): Promise<{text:string}>, tripPipeline?(requestType:string,input:object): Promise<{text:string}> }} deps.aiProvider
 * @param {string} deps.secret COTRIP_AI_GATEWAY_SECRET（来自云函数环境变量）
 * @param {number} [deps.maxBodyBytes]
 * @param {number} [deps.maxRawTextLength]
 */
function createGateway({ aiProvider, secret, maxBodyBytes = 64 * 1024, maxRawTextLength = 1000 }) {
  async function handle({ method, url, headers = {}, bodyText = '' }) {
    if (method === 'GET' && url === '/health') {
      return json(200, { ok: true, service: 'cotrip-ai-analyze' });
    }

    const pipelineRequestType = PIPELINE_ROUTES[url];
    if (method !== 'POST' || (url !== '/analyze' && url !== '/coordinate' && !pipelineRequestType)) {
      return json(404, { ok: false, error: 'NOT_FOUND' });
    }

    if (!authorizedOrUnauthorized(headers, secret)) {
      return json(401, { ok: false, error: 'UNAUTHORIZED' });
    }

    if (Buffer.byteLength(bodyText) > maxBodyBytes) {
      return json(400, { ok: false, error: 'REQUEST_TOO_LARGE' });
    }

    const parsedBody = parseJsonBody(bodyText);
    if (!parsedBody.ok) {
      return json(400, { ok: false, error: 'INVALID_JSON' });
    }

    if (url === '/coordinate') {
      return handleCoordinate(aiProvider, parsedBody.value);
    }

    if (pipelineRequestType) {
      return handlePipeline(aiProvider, pipelineRequestType, parsedBody.value);
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

    const validation = validateGatewayAnalysis(analysis);
    if (!validation.ok) {
      console.error(
        '[cotrip-ai-analyze] invalid AI response:',
        validation.failurePath,
        validation.failureReasonCode,
      );
      return json(502, { ok: false, error: 'AI_INVALID_RESPONSE' });
    }

    return json(200, { ok: true, analysis });
  }

  return { handle };
}

async function handlePipeline(aiProvider, requestType, body) {
  const input = validatePipelineInput(requestType, body);
  if (!input.ok) {
    return json(400, { ok: false, error: 'INVALID_INPUT' });
  }
  if (!aiProvider.tripPipeline || typeof aiProvider.tripPipeline !== 'function') {
    return json(503, { ok: false, error: 'PIPELINE_NOT_SUPPORTED' });
  }

  let aiResult;
  try {
    aiResult = await aiProvider.tripPipeline(requestType, input.value);
  } catch {
    // 不记录 provider error message：SDK 有可能把请求摘要带入 message。
    console.error('[cotrip-ai-pipeline] provider failure:', requestType);
    return json(502, { ok: false, error: 'AI_PROVIDER_FAILURE' });
  }

  let envelope;
  try {
    envelope = parseStrictJsonContent(aiResult && aiResult.text);
  } catch {
    return json(502, { ok: false, error: 'AI_INVALID_RESPONSE' });
  }
  const validation = validatePipelineEnvelope(envelope, requestType, input.value);
  if (!validation.ok) {
    console.error(
      '[cotrip-ai-pipeline] invalid AI response:',
      requestType,
      validation.failurePath,
      validation.failureReasonCode,
    );
    return json(502, { ok: false, error: 'AI_INVALID_RESPONSE' });
  }
  return json(200, { envelope });
}

async function handleCoordinate(aiProvider, body) {
  if (!aiProvider.coordinate || typeof aiProvider.coordinate !== 'function') {
    return json(503, { ok: false, error: 'COORDINATE_NOT_SUPPORTED' });
  }

  const input = validateCoordinateInput(body);
  if (!input.ok) {
    return json(400, { ok: false, error: input.error });
  }

  let aiResult;
  try {
    aiResult = await aiProvider.coordinate(input.value);
  } catch (error) {
    console.error('[cotrip-ai-coordinate] provider failure:', error && error.message);
    return json(502, { ok: false, error: 'AI_PROVIDER_FAILURE' });
  }

  let proposal;
  try {
    proposal = parseProposalJson(aiResult && aiResult.text);
  } catch {
    return json(502, { ok: false, error: 'AI_INVALID_RESPONSE' });
  }

  const validation = validateCoordinateProposal(proposal);
  if (!validation.ok) {
    console.error(
      '[cotrip-ai-coordinate] invalid AI response:',
      validation.failurePath,
      validation.failureReasonCode,
    );
    return json(502, { ok: false, error: 'AI_INVALID_RESPONSE' });
  }

  return json(200, { ok: true, proposal });
}

module.exports = { createGateway };
