// tests/coordinate.test.js
// /coordinate 网关逻辑测试：全部 mock provider，不真实访问 CloudBase / hy3。

const assert = require('assert');
const { record } = require('./run-tests');
const { createGateway } = require('../lib/gateway');
const { createCloudBaseAIProvider } = require('../lib/cloudbase-ai');
const {
  parseProposalJson,
  validateCoordinateProposal,
  isValidCoordinateProposal,
} = require('../lib/coordinate-response-parser');
const { COORDINATION_SYSTEM_PROMPT } = require('../lib/coordinate-prompt');
const { validateCoordinateInput } = require('../lib/request-parser');

const SECRET = 'cotrip-test-secret';
const VALID_PROPOSAL = {
  summary: '三人共同时间 16:00-17:00',
  status: 'READY',
  suggestions: [
    {
      kind: 'ADJUST_TIME',
      affectedConstraintIds: ['c1', 'c2'],
      message: '建议优先选择交通时间短的地点',
      requiresConfirmation: false,
      confidence: 0.8,
    },
  ],
};

const VALID_COORDINATION = {
  coordination: {
    tripId: 'trip_T',
    participants: [{ id: 'u1', label: '成员A' }],
    constraints: [],
    deterministicEvaluation: {
      tripId: 'trip_T',
      activeConstraintCount: 0,
      hardConstraintCount: 0,
      softConstraintCount: 0,
      participantCount: 1,
      hardConflicts: [],
      softTensions: [],
      supersessionCandidates: [],
      requiresConfirmation: false,
      updatedAt: '2026-08-30T00:00:00.000Z',
    },
    conflicts: [],
  },
};

function providerReturning(text) {
  return {
    async analyze() { return { text: JSON.stringify({ intent: 'chat', constraints: [], confidence: 0.5, requiresConfirmation: false }) }; },
    async coordinate() { return { text }; },
  };
}
function providerFailing() {
  return {
    async analyze() { throw new Error('provider exploded'); },
    async coordinate() { throw new Error('provider exploded'); },
  };
}
function providerWithoutCoordinate() {
  return {
    async analyze() { return { text: '{}' }; },
  };
}
function gateway(aiProvider = providerReturning(JSON.stringify(VALID_PROPOSAL))) {
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

async function runCoordinateTests() {
  await record('coordinate: 无 Authorization → 401', async () => {
    const res = await gateway().handle({ method: 'POST', url: '/coordinate', headers: {}, bodyText: JSON.stringify(VALID_COORDINATION) });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, 'UNAUTHORIZED');
  });

  await record('coordinate: 缺 coordination 字段 → 400 COORDINATION_REQUIRED', async () => {
    const res = await gateway().handle({ method: 'POST', url: '/coordinate', headers: authHeaders(), bodyText: JSON.stringify({}) });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'COORDINATION_REQUIRED');
  });

  await record('coordinate: 结构不完整 → 400 COORDINATION_SHAPE_INVALID', async () => {
    const res = await gateway().handle({ method: 'POST', url: '/coordinate', headers: authHeaders(), bodyText: JSON.stringify({ coordination: { tripId: 't', constraints: [], conflicts: [] } }) });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'COORDINATION_SHAPE_INVALID');
  });

  await record('coordinate: 正常输入 → 200 且返回 proposal', async () => {
    const res = await gateway().handle({ method: 'POST', url: '/coordinate', headers: authHeaders(), bodyText: JSON.stringify(VALID_COORDINATION) });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.deepStrictEqual(res.body.proposal, VALID_PROPOSAL);
  });

  await record('coordinate: provider 无 coordinate 能力 → 503 COORDINATE_NOT_SUPPORTED', async () => {
    const res = await gateway(providerWithoutCoordinate()).handle({ method: 'POST', url: '/coordinate', headers: authHeaders(), bodyText: JSON.stringify(VALID_COORDINATION) });
    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.body.error, 'COORDINATE_NOT_SUPPORTED');
  });

  await record('coordinate: provider 失败 → 502 AI_PROVIDER_FAILURE', async () => {
    const res = await gateway(providerFailing()).handle({ method: 'POST', url: '/coordinate', headers: authHeaders(), bodyText: JSON.stringify(VALID_COORDINATION) });
    assert.strictEqual(res.status, 502);
    assert.strictEqual(res.body.error, 'AI_PROVIDER_FAILURE');
  });

  await record('coordinate: AI 输出非法 JSON → 502 AI_INVALID_RESPONSE', async () => {
    const res = await gateway(providerReturning('这不是 JSON')).handle({ method: 'POST', url: '/coordinate', headers: authHeaders(), bodyText: JSON.stringify(VALID_COORDINATION) });
    assert.strictEqual(res.status, 502);
    assert.strictEqual(res.body.error, 'AI_INVALID_RESPONSE');
  });

  await record('coordinate: AI 输出含 satisfied → 502 AI_FORBIDDEN_SATISFACTION_FIELD', async () => {
    const bad = { summary: 'x', status: 'READY', suggestions: [], satisfied: true };
    const { result: res } = await captureConsoleError(() => gateway(providerReturning(JSON.stringify(bad))).handle({ method: 'POST', url: '/coordinate', headers: authHeaders(), bodyText: JSON.stringify(VALID_COORDINATION) }));
    assert.strictEqual(res.status, 502);
    assert.strictEqual(res.body.error, 'AI_INVALID_RESPONSE');
  });

  await record('coordinate: AI 输出含 resolved → 502', async () => {
    const bad = { summary: 'x', status: 'READY', suggestions: [{ kind: 'OTHER', affectedConstraintIds: [], message: 'm', requiresConfirmation: false, confidence: 0.5, resolved: true }] };
    const res = await gateway(providerReturning(JSON.stringify(bad))).handle({ method: 'POST', url: '/coordinate', headers: authHeaders(), bodyText: JSON.stringify(VALID_COORDINATION) });
    assert.strictEqual(res.status, 502);
    assert.strictEqual(res.body.error, 'AI_INVALID_RESPONSE');
  });

  await record('coordinate: markdown fenced JSON → 200 正确解析', async () => {
    const res = await gateway(providerReturning('```json\n' + JSON.stringify(VALID_PROPOSAL) + '\n```')).handle({ method: 'POST', url: '/coordinate', headers: authHeaders(), bodyText: JSON.stringify(VALID_COORDINATION) });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.proposal, VALID_PROPOSAL);
  });

  await record('coordinate: /analyze 请求仍走原路由 → 200', async () => {
    const res = await gateway().handle({ method: 'POST', url: '/analyze', headers: authHeaders(), bodyText: JSON.stringify({ rawText: '想打羽毛球' }) });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.analysis.intent, 'chat');
  });

  await record('parser: validateCoordinateProposal 规则', () => {
    assert.deepStrictEqual(validateCoordinateProposal(VALID_PROPOSAL), { ok: true });
    assert.strictEqual(isValidCoordinateProposal(VALID_PROPOSAL), true);
    assert.strictEqual(isValidCoordinateProposal(null), false);
    assert.strictEqual(isValidCoordinateProposal({ summary: '', status: 'READY', suggestions: [] }), false);
    assert.strictEqual(isValidCoordinateProposal({ summary: 'x', status: 'HACKED', suggestions: [] }), false);
    assert.strictEqual(isValidCoordinateProposal({ summary: 'x', status: 'READY', suggestions: 'bad' }), false);
    assert.strictEqual(isValidCoordinateProposal({ summary: 'x', status: 'READY', suggestions: [], satisfied: true }), false);
    assert.strictEqual(isValidCoordinateProposal({ summary: 'x', status: 'READY', suggestions: [{ kind: 'BAD', affectedConstraintIds: [], message: 'm', requiresConfirmation: false, confidence: 0.5 }] }), false);
  });

  await record('parser: validateCoordinateInput 规则', () => {
    assert.strictEqual(validateCoordinateInput(null).ok, false);
    assert.strictEqual(validateCoordinateInput({}).error, 'COORDINATION_REQUIRED');
    assert.strictEqual(validateCoordinateInput({ coordination: { tripId: '', constraints: [], conflicts: [] } }).error, 'TRIP_ID_REQUIRED');
    assert.strictEqual(validateCoordinateInput(VALID_COORDINATION).ok, true);
  });

  await record('prompt: 明确 Server truth 与禁止字段', () => {
    assert.ok(COORDINATION_SYSTEM_PROMPT.includes('Server truth'));
    assert.ok(COORDINATION_SYSTEM_PROMPT.includes('不得重新计算或推翻'));
    assert.ok(COORDINATION_SYSTEM_PROMPT.includes('不得声称某约束已满足'));
    assert.ok(COORDINATION_SYSTEM_PROMPT.includes('不得编造真实地点'));
  });

  await record('@cloudbase/ai: coordinate 使用同一 hy3 模型且 system prompt 正确', async () => {
    let inputs = [];
    const provider = createCloudBaseAIProvider({
      createModel() {
        return {
          async generateText(candidate) {
            inputs.push(candidate);
            return { text: JSON.stringify(VALID_PROPOSAL) };
          },
        };
      },
    });
    await provider.coordinate(VALID_COORDINATION.coordination);
    assert.strictEqual(inputs.length, 1);
    assert.strictEqual(inputs[0].model, 'hy3');
    assert.strictEqual(inputs[0].messages[0].content, COORDINATION_SYSTEM_PROMPT);
  });

  await record('parser: parseProposalJson 剥离 fence', () => {
    assert.deepStrictEqual(parseProposalJson('```json\n{"a":1}\n```'), { a: 1 });
    assert.throws(() => parseProposalJson('   '));
  });
}

module.exports = { runCoordinateTests };
