// tests/gateway.test.js
// 网关纯逻辑测试：不真实访问 CloudBase / hy3，AI 调用全部注入 mock。

const assert = require('assert');
const { record } = require('./run-tests');
const { createGateway } = require('../lib/gateway');
const { safeEqual } = require('../lib/auth');
const { stripMarkdownFence, extractJsonContent, isValidGatewayAnalysis } = require('../lib/ai-response-parser');
const { parseJsonBody, validateAnalyzeInput } = require('../lib/request-parser');

const SECRET = 'cotrip-test-secret';
const VALID_ANALYSIS = {
  intent: 'preference',
  constraints: [
    { type: 'PREFERENCE', scope: 'DINING', priority: 'SOFT', value: { keyword: 'VIETNAMESE' } },
  ],
  confidence: 0.95,
  requiresConfirmation: false,
};

function providerReturning(text) {
  return { async analyze() { return { text }; } };
}
function providerFailing() {
  return { async analyze() { throw new Error('provider exploded'); } };
}
function gateway(aiProvider = providerReturning(JSON.stringify(VALID_ANALYSIS))) {
  return createGateway({ aiProvider, secret: SECRET });
}
function authHeaders() {
  return { authorization: `Bearer ${SECRET}` };
}

async function runGatewayTests() {
  await record('health: GET /health → 200（匿名）', async () => {
    const res = await gateway().handle({ method: 'GET', url: '/health', headers: {}, bodyText: '' });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { ok: true, service: 'cotrip-ai-analyze' });
  });

  await record('analyze: 无 Authorization → 401', async () => {
    const res = await gateway().handle({ method: 'POST', url: '/analyze', headers: {}, bodyText: JSON.stringify({ rawText: '想打羽毛球' }) });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, 'UNAUTHORIZED');
  });

  await record('analyze: 错误 secret → 401', async () => {
    const res = await gateway().handle({ method: 'POST', url: '/analyze', headers: { authorization: 'Bearer wrong-secret' }, bodyText: JSON.stringify({ rawText: '想打羽毛球' }) });
    assert.strictEqual(res.status, 401);
  });

  await record('analyze: secret 未配置（空）→ 一律 401', async () => {
    const g = createGateway({ aiProvider: providerReturning('{}'), secret: '' });
    const res = await g.handle({ method: 'POST', url: '/analyze', headers: authHeaders(), bodyText: JSON.stringify({ rawText: '想打羽毛球' }) });
    assert.strictEqual(res.status, 401);
  });

  await record('analyze: 空 rawText → 400 RAW_TEXT_REQUIRED', async () => {
    const res = await gateway().handle({ method: 'POST', url: '/analyze', headers: authHeaders(), bodyText: JSON.stringify({ rawText: '   ' }) });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'RAW_TEXT_REQUIRED');
  });

  await record('analyze: 非法 JSON → 400 INVALID_JSON', async () => {
    const res = await gateway().handle({ method: 'POST', url: '/analyze', headers: authHeaders(), bodyText: '{not json' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'INVALID_JSON');
  });

  await record('analyze: rawText 超 1000 → 400 RAW_TEXT_TOO_LONG', async () => {
    const res = await gateway().handle({ method: 'POST', url: '/analyze', headers: authHeaders(), bodyText: JSON.stringify({ rawText: 'x'.repeat(1001) }) });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'RAW_TEXT_TOO_LONG');
  });

  await record('analyze: 请求体超限 → 400 REQUEST_TOO_LARGE', async () => {
    const g = createGateway({ aiProvider: providerReturning('{}'), secret: SECRET, maxBodyBytes: 1024 });
    const res = await g.handle({ method: 'POST', url: '/analyze', headers: authHeaders(), bodyText: JSON.stringify({ rawText: 'x'.repeat(2048) }) });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'REQUEST_TOO_LARGE');
  });

  await record('analyze: provider 失败 → 502 AI_PROVIDER_FAILURE', async () => {
    const res = await gateway(providerFailing()).handle({ method: 'POST', url: '/analyze', headers: authHeaders(), bodyText: JSON.stringify({ rawText: '想打羽毛球' }) });
    assert.strictEqual(res.status, 502);
    assert.strictEqual(res.body.error, 'AI_PROVIDER_FAILURE');
  });

  await record('analyze: AI 输出非法 JSON → 502 AI_INVALID_RESPONSE', async () => {
    const res = await gateway(providerReturning('这不是 JSON')).handle({ method: 'POST', url: '/analyze', headers: authHeaders(), bodyText: JSON.stringify({ rawText: '想打羽毛球' }) });
    assert.strictEqual(res.status, 502);
    assert.strictEqual(res.body.error, 'AI_INVALID_RESPONSE');
  });

  await record('analyze: AI 输出 shape 非法 → 502 AI_INVALID_RESPONSE', async () => {
    const bad = { intent: 'hacked', constraints: [], confidence: 'x', requiresConfirmation: false };
    const res = await gateway(providerReturning(JSON.stringify(bad))).handle({ method: 'POST', url: '/analyze', headers: authHeaders(), bodyText: JSON.stringify({ rawText: '想打羽毛球' }) });
    assert.strictEqual(res.status, 502);
    assert.strictEqual(res.body.error, 'AI_INVALID_RESPONSE');
  });

  await record('analyze: markdown fenced JSON → 200 正确解析', async () => {
    const res = await gateway(providerReturning('```json\n' + JSON.stringify(VALID_ANALYSIS) + '\n```')).handle({ method: 'POST', url: '/analyze', headers: authHeaders(), bodyText: JSON.stringify({ rawText: '想打羽毛球' }) });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.analysis, VALID_ANALYSIS);
  });

  await record('analyze: 正常 AICommentAnalysis → 200', async () => {
    const res = await gateway().handle({
      method: 'POST',
      url: '/analyze',
      headers: authHeaders(),
      bodyText: JSON.stringify({ rawText: '我下午五点前必须走', context: { tripId: 'trip_T', timezone: 'Asia/Shanghai' } }),
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.analysis.intent, 'preference');
    assert.strictEqual(res.body.analysis.constraints[0].value.keyword, 'VIETNAMESE');
  });

  await record('analyze: 非 /analyze 路径 → 404', async () => {
    const res = await gateway().handle({ method: 'POST', url: '/other', headers: authHeaders(), bodyText: '{}' });
    assert.strictEqual(res.status, 404);
  });

  await record('auth: safeEqual 长度不同返回 false', () => {
    assert.strictEqual(safeEqual('abc', 'abcdef'), false);
    assert.strictEqual(safeEqual('abc', 'abc'), true);
    assert.strictEqual(safeEqual('abc', 'abd'), false);
  });

  await record('parser: 单层 markdown fence 剥离', () => {
    assert.strictEqual(stripMarkdownFence('```json\n{"a":1}\n```'), '{"a":1}');
    assert.strictEqual(stripMarkdownFence('{"a":1}'), '{"a":1}');
    assert.deepStrictEqual(extractJsonContent('```json\n{"a":1}\n```'), { a: 1 });
  });

  await record('parser: extractJsonContent 空文本抛错', () => {
    assert.throws(() => extractJsonContent('   '));
    assert.throws(() => extractJsonContent('{broken'));
  });

  await record('parser: isValidGatewayAnalysis 规则', () => {
    assert.strictEqual(isValidGatewayAnalysis(VALID_ANALYSIS), true);
    assert.strictEqual(isValidGatewayAnalysis({ intent: 'constraint', constraints: [], confidence: 0.5, requiresConfirmation: false }), true);
    assert.strictEqual(isValidGatewayAnalysis(null), false);
    assert.strictEqual(isValidGatewayAnalysis({ intent: 'chat' }), false);
  });

  await record('parser: validateAnalyzeInput 规则', () => {
    assert.strictEqual(validateAnalyzeInput(null).ok, false);
    assert.strictEqual(validateAnalyzeInput({ rawText: '' }).error, 'RAW_TEXT_REQUIRED');
    assert.strictEqual(validateAnalyzeInput({ rawText: ' hello ' }).value.rawText, 'hello');
    assert.strictEqual(validateAnalyzeInput({ rawText: 'hello', context: 'bad' }).error, 'INVALID_CONTEXT');
    assert.strictEqual(validateAnalyzeInput({ rawText: 'hello', context: { tripId: 1 } }).value.context.tripId, undefined);
    assert.strictEqual(parseJsonBody('{bad').ok, false);
    assert.strictEqual(parseJsonBody('{"a":1}').value.a, 1);
    assert.strictEqual(parseJsonBody('').ok, true);
  });
}

module.exports = { runGatewayTests };
