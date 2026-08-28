// tests/gateway.test.js
// 网关纯逻辑测试：不真实访问 CloudBase / hy3，AI 调用全部注入 mock。

const assert = require('assert');
const { record } = require('./run-tests');
const { createGateway } = require('../lib/gateway');
const { createCloudBaseAIProvider } = require('../lib/cloudbase-ai');
const { safeEqual } = require('../lib/auth');
const {
  stripMarkdownFence,
  extractJsonContent,
  validateGatewayAnalysis,
  isValidGatewayAnalysis,
} = require('../lib/ai-response-parser');
const { SYSTEM_PROMPT } = require('../lib/prompt');
const { parseJsonBody, validateAnalyzeInput } = require('../lib/request-parser');
const CONTRACT_FIXTURES = require('../../../contracts/ai-comment-analysis-fixtures.json');

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

async function captureConsoleError(action) {
  const original = console.error;
  const calls = [];
  console.error = (...args) => calls.push(args);
  try {
    return { result: await action(), calls };
  } finally {
    console.error = original;
  }
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
    const { result: res } = await captureConsoleError(() => gateway(providerReturning(JSON.stringify(bad))).handle({ method: 'POST', url: '/analyze', headers: authHeaders(), bodyText: JSON.stringify({ rawText: '想打羽毛球' }) }));
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
    assert.strictEqual(isValidGatewayAnalysis({ intent: 'constraint', constraints: [], confidence: 0.5, requiresConfirmation: false }), false);
    assert.strictEqual(isValidGatewayAnalysis(null), false);
    assert.strictEqual(isValidGatewayAnalysis({ intent: 'chat' }), false);
  });

  for (const fixture of CONTRACT_FIXTURES.valid) {
    await record(`contract valid: ${fixture.name}`, () => {
      assert.deepStrictEqual(validateGatewayAnalysis(fixture.analysis), { ok: true });
    });
  }

  for (const fixture of CONTRACT_FIXTURES.invalid) {
    await record(`contract invalid: ${fixture.name}`, () => {
      assert.deepStrictEqual(validateGatewayAnalysis(fixture.analysis), {
        ok: false,
        failurePath: fixture.failurePath,
        failureReasonCode: fixture.failureReasonCode,
      });
    });
  }

  await record('contract canonical: mixed 与 chat 均通过 Gateway', () => {
    const mixed = CONTRACT_FIXTURES.valid.find((fixture) => fixture.name === 'mixed availability and dining preference');
    const chat = CONTRACT_FIXTURES.valid.find((fixture) => fixture.name === 'chat without constraints');
    assert.strictEqual(isValidGatewayAnalysis(mixed.analysis), true);
    assert.strictEqual(mixed.analysis.constraints[0].value.availableUntil, '2026-08-29T17:00:00+08:00');
    assert.strictEqual(mixed.analysis.constraints[1].value.keyword, '越南菜');
    assert.strictEqual(isValidGatewayAnalysis(chat.analysis), true);
    assert.deepStrictEqual(chat.analysis.constraints, []);
  });

  await record('gateway diagnostics: 只记录路径和原因码，客户端只见通用错误', async () => {
    const fixture = CONTRACT_FIXTURES.invalid.find((candidate) => candidate.name === 'availability value extra reason');
    const rawText = 'private-comment-text';
    const { result: res, calls } = await captureConsoleError(() => gateway(
      providerReturning(JSON.stringify(fixture.analysis)),
    ).handle({
      method: 'POST',
      url: '/analyze',
      headers: authHeaders(),
      bodyText: JSON.stringify({ rawText }),
    }));
    assert.strictEqual(res.status, 502);
    assert.deepStrictEqual(res.body, { ok: false, error: 'AI_INVALID_RESPONSE' });
    const logged = JSON.stringify(calls);
    assert.ok(logged.includes(fixture.failurePath));
    assert.ok(logged.includes(fixture.failureReasonCode));
    assert.ok(!logged.includes(rawText));
    assert.ok(!logged.includes('extra'));
  });

  await record('prompt: 精确 schema、ISO、失败策略和 canonical examples 齐全', () => {
    assert.ok(SYSTEM_PROMPT.includes('禁止任何其他字段'));
    assert.ok(SYSTEM_PROMPT.includes('"availableUntil"?: string'));
    assert.ok(SYSTEM_PROMPT.includes('2026-08-29T17:00:00+08:00'));
    assert.ok(SYSTEM_PROMPT.includes('"keyword"?: string'));
    assert.ok(SYSTEM_PROMPT.includes('"intent":"unclear","constraints":[]'));
    assert.ok(SYSTEM_PROMPT.includes('"rawText":"哈哈哈哈"'));
  });

  await record('@cloudbase/ai: generateText 不注入未支持的 structured-output 参数', async () => {
    let input;
    const provider = createCloudBaseAIProvider({
      createModel() {
        return {
          async generateText(candidate) {
            input = candidate;
            return { text: JSON.stringify(VALID_ANALYSIS) };
          },
        };
      },
    });
    await provider.analyze({ rawText: '想吃越南菜', context: null });
    assert.strictEqual(input.response_format, undefined);
    assert.strictEqual(input.responseFormat, undefined);
    assert.strictEqual(input.json_schema, undefined);
    assert.strictEqual(input.jsonSchema, undefined);
    assert.strictEqual(input.messages[0].content, SYSTEM_PROMPT);
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
