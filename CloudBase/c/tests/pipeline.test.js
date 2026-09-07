// AI Trip Pipeline V2 Gateway tests. All AI calls are injected mocks.

const assert = require('assert');
const { createGateway } = require('../lib/gateway');
const { createCloudBaseAIProvider } = require('../lib/cloudbase-ai');
const {
  parseStrictJsonContent,
  validatePipelineInput,
  validatePipelineEnvelope,
} = require('../lib/pipeline-contract');
const { PIPELINE_SYSTEM_PROMPTS } = require('../lib/pipeline-prompt');

const SECRET = 'pipeline-test-secret';
const UI_EMPTY = {
  changedEventIds: [],
  highlightEventIds: [],
  removedEventIds: [],
  message: null,
};
const TRIP_INPUT = {
  title: '测试周末活动',
  initialBrief: '四个人下午活动，晚上吃饭',
};
const COMMENT = {
  id: 'comment_test_1',
  rawText: '晚上不要吃辣',
  createdAt: '2026-09-05T08:00:00.000Z',
};
const CURRENT_PLAN = {
  id: 'plan_trip_test_v1',
  tripId: 'trip_test',
  version: 1,
  events: [
    {
      id: 'event_trip_test_1_1',
      type: 'SPORT',
      title: '室内运动',
      time: {
        start: '2026-09-05T15:00:00+08:00',
        end: '2026-09-05T17:00:00+08:00',
        timezone: 'Asia/Shanghai',
      },
      locationRequirement: { city: '测试城' },
    },
    {
      id: 'event_trip_test_1_2',
      type: 'DINING',
      title: '晚餐',
      time: { start: '2026-09-05T18:00:00+08:00', timezone: 'Asia/Shanghai' },
      locationRequirement: { city: '测试城' },
    },
  ],
  summary: '下午运动，晚上吃饭',
  satisfiedConstraintCount: 0,
  totalConstraintCount: 0,
  conflicts: [],
  updatedAt: '2026-09-05T07:00:00.000Z',
};

const BODIES = {
  PREPROCESS: {
    preprocess: { title: TRIP_INPUT.title, tripInput: TRIP_INPUT },
  },
  COMMENT_EVALUATION: {
    commentEvaluation: {
      title: TRIP_INPUT.title,
      tripInput: TRIP_INPUT,
      aiContext: null,
      comment: COMMENT,
    },
  },
  INITIAL_GENERATION: {
    initialGeneration: {
      title: TRIP_INPUT.title,
      tripInput: TRIP_INPUT,
      aiContext: null,
      triggeringComment: COMMENT,
    },
  },
  TRIP_UPDATE: {
    tripUpdate: {
      title: TRIP_INPUT.title,
      tripInput: TRIP_INPUT,
      aiContext: null,
      currentPlan: CURRENT_PLAN,
      triggeringComment: COMMENT,
      commentEvaluation: {
        commentIntent: '晚餐饮食限制',
        relevant: true,
        usable: true,
        updateRequired: true,
        reason: '新增不吃辣的硬性要求',
      },
      baseVersion: 1,
    },
  },
};

const ENVELOPES = {
  PREPROCESS: {
    schemaVersion: '1.0',
    requestType: 'PREPROCESS',
    status: 'success',
    analysis: {
      title: TRIP_INPUT.title,
      intent: '安排下午活动与晚餐',
      constraints: { participantCount: 4 },
      activities: ['下午活动', '晚餐'],
      missingInformation: ['具体活动类型'],
    },
    decision: { canGenerateTrip: false },
    trip: null,
    ui: UI_EMPTY,
    meta: {},
  },
  COMMENT_EVALUATION: {
    schemaVersion: '1.0',
    requestType: 'COMMENT_EVALUATION',
    status: 'success',
    analysis: { commentIntent: '新增晚餐饮食限制' },
    decision: {
      relevant: true,
      usable: true,
      updateRequired: true,
      reason: '评论提供了可消费的新饮食约束',
    },
    trip: null,
    ui: UI_EMPTY,
    meta: {},
  },
  INITIAL_GENERATION: {
    schemaVersion: '1.0',
    requestType: 'INITIAL_GENERATION',
    status: 'success',
    analysis: {},
    decision: { tripChanged: true },
    trip: {
      title: TRIP_INPUT.title,
      summary: '下午进行室内活动，晚上安排不辣晚餐',
      items: [
        {
          type: 'SPORT',
          title: '室内活动',
          time: {
            start: '2026-09-05T15:00:00+08:00',
            end: '2026-09-05T17:00:00+08:00',
            timezone: 'Asia/Shanghai',
          },
          locationRequirement: { city: '测试城' },
        },
        {
          type: 'DINING',
          title: '不辣晚餐',
          time: { start: '2026-09-05T18:00:00+08:00', timezone: 'Asia/Shanghai' },
          locationRequirement: { city: '测试城' },
        },
      ],
    },
    ui: UI_EMPTY,
    meta: {},
  },
  TRIP_UPDATE: {
    schemaVersion: '1.0',
    requestType: 'TRIP_UPDATE',
    status: 'success',
    analysis: {},
    decision: { tripChanged: true },
    trip: {
      title: TRIP_INPUT.title,
      summary: '下午运动保持不变，晚餐调整为不辣',
      items: [
        {
          ...CURRENT_PLAN.events[0],
        },
        {
          ...CURRENT_PLAN.events[1],
          title: '不辣晚餐',
        },
      ],
    },
    ui: {
      changedEventIds: ['event_trip_test_1_2'],
      highlightEventIds: ['event_trip_test_1_2'],
      removedEventIds: [],
      message: '晚餐已调整为不辣选项',
    },
    meta: {},
  },
};

const ROUTES = {
  PREPROCESS: '/preprocess',
  COMMENT_EVALUATION: '/comment-evaluation',
  INITIAL_GENERATION: '/initial-generation',
  TRIP_UPDATE: '/trip-update',
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function providerReturning(envelopeByType = ENVELOPES) {
  return {
    async analyze() { return { text: '{}' }; },
    async tripPipeline(requestType) {
      return { text: JSON.stringify(envelopeByType[requestType]) };
    },
  };
}

function gateway(aiProvider = providerReturning()) {
  return createGateway({ aiProvider, secret: SECRET });
}

function requestFor(requestType, headers = { authorization: `Bearer ${SECRET}` }) {
  return {
    method: 'POST',
    url: ROUTES[requestType],
    headers,
    bodyText: JSON.stringify(BODIES[requestType]),
  };
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

async function runPipelineTests() {
  // Lazy import avoids a circular dependency when smoke.js reuses these fixtures.
  const { record } = require('./run-tests');
  for (const requestType of Object.keys(ROUTES)) {
    await record(`${requestType} auth: 无 secret 拒绝`, async () => {
      const response = await gateway().handle(requestFor(requestType, {}));
      assert.strictEqual(response.status, 401);
      assert.strictEqual(response.body.error, 'UNAUTHORIZED');
    });

    await record(`${requestType} auth: 错误 secret 拒绝`, async () => {
      const response = await gateway().handle(requestFor(requestType, { authorization: 'Bearer wrong' }));
      assert.strictEqual(response.status, 401);
    });

    await record(`${requestType} auth: 正确 secret 接受并返回统一 envelope`, async () => {
      const response = await gateway().handle(requestFor(requestType));
      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(response.body.envelope, ENVELOPES[requestType]);
    });
  }

  await record('pipeline input: 四种主 API 真实 body 均通过', () => {
    for (const requestType of Object.keys(BODIES)) {
      const result = validatePipelineInput(requestType, BODIES[requestType]);
      assert.strictEqual(result.ok, true, requestType);
    }
  });

  await record('judge contract: commentEvaluation 不带 signals 保持向后兼容', () => {
    const result = validatePipelineInput('TRIP_UPDATE', BODIES.TRIP_UPDATE);
    assert.strictEqual(result.ok, true);
  });

  await record('judge contract: commentEvaluation 完整合法 signals 通过', () => {
    const body = clone(BODIES.TRIP_UPDATE);
    body.tripUpdate.commentEvaluation.shouldForward = true;
    body.tripUpdate.commentEvaluation.judgeStatus = 'actionable';
    body.tripUpdate.commentEvaluation.intentDomain = 'trip';
    body.tripUpdate.commentEvaluation.signals = {
      places: ['省博', '广图'],
      timeExpressions: [],
      durationExpressions: [],
      sequenceWords: ['参观完', '先去'],
      actionWords: ['参观', '去', '借'],
    };
    assert.strictEqual(validatePipelineInput('TRIP_UPDATE', body).ok, true);
  });

  await record('judge contract: signals 字段须完整镜像 Server TripSignals', () => {
    const body = clone(BODIES.TRIP_UPDATE);
    body.tripUpdate.commentEvaluation.signals = { places: ['北京路'] };
    const result = validatePipelineInput('TRIP_UPDATE', body);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.failurePath, 'tripUpdate.commentEvaluation.signals.timeExpressions');
    assert.strictEqual(result.failureReasonCode, 'REQUIRED_FIELD');
  });

  await record('judge contract: signals collection 非数组必须拒绝', () => {
    const body = clone(BODIES.TRIP_UPDATE);
    body.tripUpdate.commentEvaluation.signals = {
      places: '北京路',
      timeExpressions: [],
      durationExpressions: [],
      sequenceWords: [],
      actionWords: [],
    };
    const result = validatePipelineInput('TRIP_UPDATE', body);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.failurePath, 'tripUpdate.commentEvaluation.signals.places');
    assert.strictEqual(result.failureReasonCode, 'EXPECTED_STRING_ARRAY');
  });

  await record('judge contract: signals collection 元素非字符串必须拒绝', () => {
    const body = clone(BODIES.TRIP_UPDATE);
    body.tripUpdate.commentEvaluation.signals = {
      places: ['北京路'],
      timeExpressions: [],
      durationExpressions: [],
      sequenceWords: [],
      actionWords: [true],
    };
    const result = validatePipelineInput('TRIP_UPDATE', body);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.failurePath, 'tripUpdate.commentEvaluation.signals.actionWords[0]');
    assert.strictEqual(result.failureReasonCode, 'EXPECTED_STRING');
  });

  await record('judge contract: signals 内未知字段继续严格拒绝', () => {
    const body = clone(BODIES.TRIP_UPDATE);
    body.tripUpdate.commentEvaluation.signals = {
      places: ['北京路'],
      timeExpressions: [],
      durationExpressions: [],
      sequenceWords: [],
      actionWords: [],
      randomUnknownField: true,
    };
    const result = validatePipelineInput('TRIP_UPDATE', body);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.failurePath, 'tripUpdate.commentEvaluation.signals.randomUnknownField');
    assert.strictEqual(result.failureReasonCode, 'UNEXPECTED_KEY');
  });

  await record('pipeline input: 缺少 wrapper / 标题不一致 / baseVersion 不一致均 400', async () => {
    const missing = await gateway().handle({
      ...requestFor('PREPROCESS'),
      bodyText: '{}',
    });
    assert.strictEqual(missing.status, 400);

    const mismatch = clone(BODIES.PREPROCESS);
    mismatch.preprocess.tripInput.title = '另一个标题';
    const mismatchResponse = await gateway().handle({
      ...requestFor('PREPROCESS'),
      bodyText: JSON.stringify(mismatch),
    });
    assert.strictEqual(mismatchResponse.status, 400);

    const stale = clone(BODIES.TRIP_UPDATE);
    stale.tripUpdate.baseVersion = 2;
    const staleResponse = await gateway().handle({
      ...requestFor('TRIP_UPDATE'),
      bodyText: JSON.stringify(stale),
    });
    assert.strictEqual(staleResponse.status, 400);
  });

  await record('PREPROCESS: trip null + canGenerateTrip false + 完整统一 envelope', () => {
    const result = validatePipelineEnvelope(
      ENVELOPES.PREPROCESS,
      'PREPROCESS',
      BODIES.PREPROCESS.preprocess,
    );
    assert.strictEqual(result.ok, true);
    assert.strictEqual(ENVELOPES.PREPROCESS.trip, null);
    assert.strictEqual(ENVELOPES.PREPROCESS.decision.canGenerateTrip, false);
  });

  await record('PREPROCESS: 模型试图生成 trip 必须拒绝', () => {
    const invalid = clone(ENVELOPES.PREPROCESS);
    invalid.trip = ENVELOPES.INITIAL_GENERATION.trip;
    assert.strictEqual(validatePipelineEnvelope(invalid, 'PREPROCESS', BODIES.PREPROCESS.preprocess).ok, false);
  });

  await record('COMMENT_EVALUATION: boolean 类型严格且 trip 必须 null', () => {
    const input = BODIES.COMMENT_EVALUATION.commentEvaluation;
    assert.strictEqual(validatePipelineEnvelope(ENVELOPES.COMMENT_EVALUATION, 'COMMENT_EVALUATION', input).ok, true);
    const stringBoolean = clone(ENVELOPES.COMMENT_EVALUATION);
    stringBoolean.decision.usable = 'true';
    assert.strictEqual(validatePipelineEnvelope(stringBoolean, 'COMMENT_EVALUATION', input).failureReasonCode, 'DECISION_FLAG_NOT_BOOLEAN');
    const withTrip = clone(ENVELOPES.COMMENT_EVALUATION);
    withTrip.trip = ENVELOPES.INITIAL_GENERATION.trip;
    assert.strictEqual(validatePipelineEnvelope(withTrip, 'COMMENT_EVALUATION', input).ok, false);
  });

  await record('INITIAL_GENERATION: 完整 snapshot、tripChanged、无模型 id、无现实事实', () => {
    const input = BODIES.INITIAL_GENERATION.initialGeneration;
    assert.strictEqual(validatePipelineEnvelope(ENVELOPES.INITIAL_GENERATION, 'INITIAL_GENERATION', input).ok, true);
    assert.strictEqual(ENVELOPES.INITIAL_GENERATION.decision.tripChanged, true);
    assert.strictEqual('id' in ENVELOPES.INITIAL_GENERATION.trip.items[0], false);
  });

  await record('INITIAL_GENERATION: 自造 id 与 location/price/rating/route 均拒绝', () => {
    const input = BODIES.INITIAL_GENERATION.initialGeneration;
    for (const [key, value] of [
      ['id', 'event_fake'],
      ['location', { latitude: 1, longitude: 2 }],
      ['price', 99],
      ['rating', 5],
      ['route', '步行十分钟'],
    ]) {
      const invalid = clone(ENVELOPES.INITIAL_GENERATION);
      invalid.trip.items[0][key] = value;
      assert.strictEqual(validatePipelineEnvelope(invalid, 'INITIAL_GENERATION', input).ok, false, key);
    }
  });

  await record('TRIP_UPDATE: 完整 snapshot、tripChanged、旧 event id 与合法 ui', () => {
    const input = BODIES.TRIP_UPDATE.tripUpdate;
    const result = validatePipelineEnvelope(ENVELOPES.TRIP_UPDATE, 'TRIP_UPDATE', input);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(ENVELOPES.TRIP_UPDATE.trip.items.length, CURRENT_PLAN.events.length);
    assert.strictEqual(ENVELOPES.TRIP_UPDATE.trip.items[0].id, CURRENT_PLAN.events[0].id);
    assert.strictEqual(ENVELOPES.TRIP_UPDATE.decision.tripChanged, true);
  });

  await record('TRIP_UPDATE: 不存在的旧 id 与非法 removed id 拒绝', () => {
    const input = BODIES.TRIP_UPDATE.tripUpdate;
    const unknown = clone(ENVELOPES.TRIP_UPDATE);
    unknown.trip.items[0].id = 'event_unknown';
    assert.strictEqual(validatePipelineEnvelope(unknown, 'TRIP_UPDATE', input).failureReasonCode, 'ITEM_ID_UNKNOWN');

    const badRemoved = clone(ENVELOPES.TRIP_UPDATE);
    badRemoved.ui.removedEventIds = ['event_unknown'];
    assert.strictEqual(validatePipelineEnvelope(badRemoved, 'TRIP_UPDATE', input).ok, false);
  });

  await record('UI: style/color/className、超长 message、非法 id 全部拒绝', () => {
    const input = BODIES.TRIP_UPDATE.tripUpdate;
    for (const key of ['style', 'color', 'className']) {
      const invalid = clone(ENVELOPES.TRIP_UPDATE);
      invalid.ui[key] = 'forbidden';
      assert.strictEqual(validatePipelineEnvelope(invalid, 'TRIP_UPDATE', input).failureReasonCode, 'AI_UI_FORBIDDEN_STYLE_FIELD');
    }
    const longMessage = clone(ENVELOPES.TRIP_UPDATE);
    longMessage.ui.message = 'x'.repeat(201);
    assert.strictEqual(validatePipelineEnvelope(longMessage, 'TRIP_UPDATE', input).failureReasonCode, 'AI_UI_MESSAGE_TOO_LONG');
    const invalidId = clone(ENVELOPES.TRIP_UPDATE);
    invalidId.ui.highlightEventIds = ['event_unknown'];
    assert.strictEqual(validatePipelineEnvelope(invalidId, 'TRIP_UPDATE', input).failureReasonCode, 'AI_UI_UNKNOWN_EVENT_ID');
  });

  await record('pipeline model output: Markdown fence 与非 JSON 均拒绝', () => {
    assert.throws(() => parseStrictJsonContent('```json\n{}\n```'), /MARKDOWN_FENCE_FORBIDDEN/);
    assert.throws(() => parseStrictJsonContent('not json'), /INVALID_AI_JSON/);
    assert.deepStrictEqual(parseStrictJsonContent('{"a":1}'), { a: 1 });
  });

  await record('pipeline malformed: 缺字段、错误 requestType、trip nullability、未知字段拒绝', () => {
    const input = BODIES.INITIAL_GENERATION.initialGeneration;
    const missing = clone(ENVELOPES.INITIAL_GENERATION);
    delete missing.meta;
    assert.strictEqual(validatePipelineEnvelope(missing, 'INITIAL_GENERATION', input).ok, false);
    const wrongType = clone(ENVELOPES.INITIAL_GENERATION);
    wrongType.requestType = 'TRIP_UPDATE';
    assert.strictEqual(validatePipelineEnvelope(wrongType, 'INITIAL_GENERATION', input).ok, false);
    const nullTrip = clone(ENVELOPES.INITIAL_GENERATION);
    nullTrip.trip = null;
    assert.strictEqual(validatePipelineEnvelope(nullTrip, 'INITIAL_GENERATION', input).ok, false);
    const unknown = clone(ENVELOPES.INITIAL_GENERATION);
    unknown.extra = true;
    assert.strictEqual(validatePipelineEnvelope(unknown, 'INITIAL_GENERATION', input).ok, false);
  });

  await record('pipeline gateway: fenced model output 返回明确 502，不返回伪造 success', async () => {
    const fencedProvider = providerReturning();
    fencedProvider.tripPipeline = async () => ({
      text: `\`\`\`json\n${JSON.stringify(ENVELOPES.PREPROCESS)}\n\`\`\``,
    });
    const response = await gateway(fencedProvider).handle(requestFor('PREPROCESS'));
    assert.strictEqual(response.status, 502);
    assert.deepStrictEqual(response.body, { ok: false, error: 'AI_INVALID_RESPONSE' });
  });

  await record('pipeline diagnostics: 不记录输入、prompt、secret 或模型原文', async () => {
    const privateText = 'private synthetic comment';
    const body = clone(BODIES.COMMENT_EVALUATION);
    body.commentEvaluation.comment.rawText = privateText;
    const invalidEnvelope = clone(ENVELOPES.COMMENT_EVALUATION);
    invalidEnvelope.decision.usable = 'true';
    const provider = providerReturning({ ...ENVELOPES, COMMENT_EVALUATION: invalidEnvelope });
    const { result, calls } = await captureConsoleError(() => gateway(provider).handle({
      ...requestFor('COMMENT_EVALUATION'),
      bodyText: JSON.stringify(body),
    }));
    assert.strictEqual(result.status, 502);
    const logged = JSON.stringify(calls);
    assert.ok(logged.includes('DECISION_FLAG_NOT_BOOLEAN'));
    assert.ok(!logged.includes(privateText));
    assert.ok(!logged.includes(SECRET));
    assert.ok(!logged.includes('system prompt'));
  });

  await record('pipeline provider: 四类请求复用 hunyuan-v3/hy3 且不注入额外凭据', async () => {
    const calls = [];
    const provider = createCloudBaseAIProvider({
      createModel(name) {
        assert.strictEqual(name, 'hunyuan-v3');
        return {
          async generateText(input) {
            calls.push(input);
            const payload = JSON.parse(input.messages[1].content);
            return { text: JSON.stringify(ENVELOPES[payload.requestType]) };
          },
        };
      },
    });
    for (const requestType of Object.keys(ROUTES)) {
      const input = validatePipelineInput(requestType, BODIES[requestType]).value;
      await provider.tripPipeline(requestType, input);
    }
    assert.strictEqual(calls.length, 4);
    for (let index = 0; index < calls.length; index += 1) {
      assert.strictEqual(calls[index].model, 'hy3');
      assert.strictEqual(calls[index].temperature, 0);
      assert.strictEqual(calls[index].messages[0].content, PIPELINE_SYSTEM_PROMPTS[Object.keys(ROUTES)[index]]);
      assert.strictEqual(calls[index].response_format, undefined);
      assert.strictEqual(calls[index].apiKey, undefined);
    }
  });

  await record('pipeline prompts: JSON、事实、ID、稳定更新与 UI 边界齐全', () => {
    for (const prompt of Object.values(PIPELINE_SYSTEM_PROMPTS)) {
      assert.ok(prompt.includes('只输出一个纯 JSON object'));
      assert.ok(prompt.includes('禁止 Markdown fence'));
      assert.ok(prompt.includes('color'));
    }
    assert.ok(PIPELINE_SYSTEM_PROMPTS.INITIAL_GENERATION.includes('绝不能包含 id'));
    assert.ok(PIPELINE_SYSTEM_PROMPTS.INITIAL_GENERATION.includes('真实价格'));
    assert.ok(PIPELINE_SYSTEM_PROMPTS.INITIAL_GENERATION.includes('"requestType":"INITIAL_GENERATION"'));
    assert.ok(PIPELINE_SYSTEM_PROMPTS.INITIAL_GENERATION.includes('不是 events'));
    assert.ok(PIPELINE_SYSTEM_PROMPTS.TRIP_UPDATE.includes('无关活动、时间、说明和有效约束必须保持稳定'));
    assert.ok(PIPELINE_SYSTEM_PROMPTS.TRIP_UPDATE.includes('item.id 必须原样沿用'));
  });
}

module.exports = {
  BODIES,
  ENVELOPES,
  ROUTES,
  runPipelineTests,
};
