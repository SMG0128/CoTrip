// AI Trip Pipeline V2 · Stage 3 · 统一 AI Envelope 与 AI UI 配置测试。
//
// 覆盖：
// - 四种 requestType 共享固定顶层字段（schemaVersion / requestType / status /
//   analysis / decision / trip / ui / meta），且各自 trip / decision 不变量正确
// - ui 只能表达语义：任何样式字段（color / style / className …）一律拒绝
// - ui 严格 validation：未知字段、非字符串 id、超长数组、超长 message、
//   HTML/脚本注入、不存在的 item id 全部正确失败

import assert from 'assert';
import {
  AI_ENVELOPE_SCHEMA_VERSION,
  AI_UI_MAX_IDS_PER_FIELD,
  AI_UI_MAX_MESSAGE_LENGTH,
  AIRequestType,
  emptyAIUIConfig,
} from '../src/types/ai-envelope';
import { validateAIUIConfig } from '../src/services/ai-ui-config-validation';
import { validatePreprocessEnvelope } from '../src/services/trip-preprocess-ai-validation';
import { validateCommentEvaluationEnvelope } from '../src/services/comment-evaluation-ai-validation';
import { validateInitialGenerationEnvelope } from '../src/services/initial-generation-ai-validation';
import { validateTripUpdateEnvelope } from '../src/services/trip-update-ai-validation';
import { TripPlan } from '../src/types/trip-plan';
import { record } from './run-tests';

const TOP_LEVEL_FIELDS = [
  'schemaVersion',
  'requestType',
  'status',
  'analysis',
  'decision',
  'trip',
  'ui',
  'meta',
];

function previousPlan(): TripPlan {
  return {
    id: 'plan_trip_T_v1',
    tripId: 'trip_T',
    version: 1,
    events: [
      {
        id: 'event_trip_T_1_1',
        type: 'SPORT',
        title: '羽毛球',
        time: { start: '2026-09-05T15:00:00+08:00', timezone: 'Asia/Shanghai' },
      },
      {
        id: 'event_trip_T_1_2',
        type: 'DINING',
        title: '晚餐',
        time: { start: '2026-09-05T18:00:00+08:00', timezone: 'Asia/Shanghai' },
      },
    ],
    summary: '首版',
    satisfiedConstraintCount: 0,
    totalConstraintCount: 0,
    conflicts: [],
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

/** 四类 envelope 的统一顶层样例（各自满足自身不变量） */
function envelopeFor(requestType: AIRequestType): Record<string, unknown> {
  const base = {
    schemaVersion: AI_ENVELOPE_SCHEMA_VERSION,
    requestType,
    status: 'success',
    ui: emptyAIUIConfig(),
    meta: {},
  };
  if (requestType === 'PREPROCESS') {
    return {
      ...base,
      analysis: {
        title: '周末羽毛球局',
        intent: '打球加聚餐',
        constraints: {},
        activities: ['羽毛球'],
        missingInformation: [],
      },
      decision: { canGenerateTrip: false },
      trip: null,
    };
  }
  if (requestType === 'COMMENT_EVALUATION') {
    return {
      ...base,
      analysis: { commentIntent: '调整晚餐' },
      decision: { relevant: true, usable: true, updateRequired: true, reason: '明确要求改晚餐' },
      trip: null,
    };
  }
  const snapshot = {
    title: '周末羽毛球局',
    summary: '下午打球，晚上吃粤菜',
    items: [
      {
        ...(requestType === 'TRIP_UPDATE' ? { id: 'event_trip_T_1_1' } : {}),
        type: 'SPORT',
        title: '羽毛球',
        time: { start: '2026-09-05T16:00:00+08:00', timezone: 'Asia/Shanghai' },
      },
    ],
  };
  return { ...base, analysis: {}, decision: { tripChanged: true }, trip: snapshot };
}

function validateFor(requestType: AIRequestType, envelope: unknown) {
  switch (requestType) {
    case 'PREPROCESS':
      return validatePreprocessEnvelope(envelope);
    case 'COMMENT_EVALUATION':
      return validateCommentEvaluationEnvelope(envelope);
    case 'INITIAL_GENERATION':
      return validateInitialGenerationEnvelope(envelope);
    case 'TRIP_UPDATE':
      return validateTripUpdateEnvelope(envelope, previousPlan());
    default:
      throw new Error(`unknown requestType ${requestType}`);
  }
}

export async function runAIEnvelopeTests(): Promise<void> {
  const ALL: AIRequestType[] = [
    'PREPROCESS',
    'COMMENT_EVALUATION',
    'INITIAL_GENERATION',
    'TRIP_UPDATE',
  ];

  await record('envelope: 四种 requestType 共享固定顶层字段且全部通过各自 validator', () => {
    for (const requestType of ALL) {
      const envelope = envelopeFor(requestType);
      for (const field of TOP_LEVEL_FIELDS) {
        assert.ok(
          field in envelope,
          `${requestType} envelope 必须包含统一顶层字段 ${field}`,
        );
      }
      const result = validateFor(requestType, envelope);
      assert.strictEqual(
        result.ok,
        true,
        `${requestType} 合法 envelope 必须通过验证（${result.failureReasonCode} @ ${result.failurePath}）`,
      );
      assert.deepStrictEqual(
        result.ui,
        emptyAIUIConfig(),
        `${requestType} 校验通过后必须返回归一化 ui`,
      );
    }
  });

  await record('envelope: trip 不变量 —— PREPROCESS / COMMENT_EVALUATION 必须 null', () => {
    for (const requestType of ['PREPROCESS', 'COMMENT_EVALUATION'] as AIRequestType[]) {
      const result = validateFor(requestType, {
        ...envelopeFor(requestType),
        trip: { title: 't', summary: 's', items: [] },
      });
      assert.strictEqual(result.ok, false, `${requestType} 携带 itinerary 必须被拒绝`);
      assert.strictEqual(result.failureReasonCode, 'AI_FORBIDDEN_ITINERARY');
    }
  });

  await record('envelope: trip 不变量 —— INITIAL_GENERATION / TRIP_UPDATE 必须非 null', () => {
    for (const requestType of ['INITIAL_GENERATION', 'TRIP_UPDATE'] as AIRequestType[]) {
      const result = validateFor(requestType, { ...envelopeFor(requestType), trip: null });
      assert.strictEqual(result.ok, false, `${requestType} 的 trip 不得为 null`);
      assert.strictEqual(result.failureReasonCode, 'TRIP_SNAPSHOT_REQUIRED');
    }
  });

  await record('envelope: decision 不变量按 requestType 严格校验', () => {
    const preprocess = validateFor('PREPROCESS', {
      ...envelopeFor('PREPROCESS'),
      decision: { canGenerateTrip: true },
    });
    assert.strictEqual(preprocess.ok, false);
    assert.strictEqual(preprocess.failureReasonCode, 'AI_FORBIDDEN_GENERATION_FLAG');

    const evaluation = validateFor('COMMENT_EVALUATION', {
      ...envelopeFor('COMMENT_EVALUATION'),
      decision: { relevant: true, usable: 'yes', updateRequired: false, reason: 'r' },
    });
    assert.strictEqual(evaluation.ok, false);
    assert.strictEqual(evaluation.failureReasonCode, 'DECISION_FLAG_NOT_BOOLEAN');

    for (const requestType of ['INITIAL_GENERATION', 'TRIP_UPDATE'] as AIRequestType[]) {
      const result = validateFor(requestType, {
        ...envelopeFor(requestType),
        decision: { tripChanged: false },
      });
      assert.strictEqual(result.ok, false, `${requestType} 必须要求 tripChanged === true`);
      assert.strictEqual(result.failureReasonCode, 'DECISION_TRIP_CHANGED_REQUIRED');
    }
  });

  await record('envelope: analysis / meta 必须是对象（统一顶层）', () => {
    for (const requestType of ALL) {
      const noAnalysis = validateFor(requestType, {
        ...envelopeFor(requestType),
        analysis: 'not-an-object',
      });
      assert.strictEqual(noAnalysis.ok, false, `${requestType} analysis 必须是对象`);

      const badMeta = validateFor(requestType, { ...envelopeFor(requestType), meta: [] });
      assert.strictEqual(badMeta.ok, false, `${requestType} meta 为数组必须被拒绝`);
      assert.strictEqual(badMeta.failureReasonCode, 'META_OBJECT_REQUIRED');
    }
  });

  await record('envelope: ui 缺省视为「无提示」并归一化为安全空值', () => {
    for (const requestType of ALL) {
      const envelope = { ...envelopeFor(requestType) };
      delete envelope.ui;
      const result = validateFor(requestType, envelope);
      assert.strictEqual(result.ok, true, `${requestType} 缺省 ui 不应视为语义违例`);
      assert.deepStrictEqual(result.ui, emptyAIUIConfig());
    }
  });

  // ---------- ui 样式禁令 ----------

  await record('ui: 样式字段（color / style / className …）一律拒绝', () => {
    for (const key of [
      'color',
      'backgroundColor',
      'fontSize',
      'fontWeight',
      'border',
      'borderRadius',
      'shadow',
      'padding',
      'margin',
      'className',
      'style',
      'animation',
      'iconUrl',
      'imageUrl',
    ]) {
      const result = validateAIUIConfig({ [key]: 'red' });
      assert.strictEqual(result.ok, false, `ui.${key} 必须被拒绝`);
      assert.strictEqual(
        result.failureReasonCode,
        'AI_UI_FORBIDDEN_STYLE_FIELD',
        `ui.${key} 必须以样式禁令拒绝`,
      );
    }
  });

  await record('ui: 未知字段一律拒绝（严格白名单）', () => {
    const result = validateAIUIConfig({ somethingElse: [] });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.failureReasonCode, 'AI_UI_UNKNOWN_FIELD');
  });

  await record('ui: 样式字段即使混在合法字段中也必须拒绝整个 envelope', () => {
    const result = validateFor('TRIP_UPDATE', {
      ...envelopeFor('TRIP_UPDATE'),
      ui: { changedEventIds: ['event_trip_T_1_1'], color: '#ff0000' },
    });
    assert.strictEqual(result.ok, false, 'AI 不得借合法字段夹带样式');
    assert.strictEqual(result.failureReasonCode, 'AI_UI_FORBIDDEN_STYLE_FIELD');
  });

  // ---------- ui 结构与边界 ----------

  await record('ui: id 必须是字符串数组，非字符串 id 拒绝', () => {
    assert.strictEqual(validateAIUIConfig({ changedEventIds: 'x' }).failureReasonCode, 'AI_UI_ID_ARRAY_REQUIRED');
    assert.strictEqual(validateAIUIConfig({ changedEventIds: [1] }).failureReasonCode, 'AI_UI_ID_NOT_STRING');
    assert.strictEqual(validateAIUIConfig({ changedEventIds: ['  '] }).failureReasonCode, 'AI_UI_ID_EMPTY');
    assert.strictEqual(
      validateAIUIConfig({ changedEventIds: ['x'.repeat(65)] }).failureReasonCode,
      'AI_UI_ID_TOO_LONG',
    );
  });

  await record('ui: 数组超长拒绝，重复 id 去重', () => {
    const tooMany = Array.from({ length: AI_UI_MAX_IDS_PER_FIELD + 1 }, (_, i) => `e${i}`);
    assert.strictEqual(
      validateAIUIConfig({ changedEventIds: tooMany }).failureReasonCode,
      'AI_UI_TOO_MANY_IDS',
    );

    const deduped = validateAIUIConfig({ changedEventIds: ['a', 'a', 'b'] });
    assert.strictEqual(deduped.ok, true);
    assert.deepStrictEqual(deduped.ui!.changedEventIds, ['a', 'b'], '重复 id 必须去重');
  });

  await record('ui: 不存在于新计划的 item id 必须拒绝', () => {
    const known = new Set(['event_1']);
    const ok = validateAIUIConfig({ changedEventIds: ['event_1'] }, { newEventIds: known });
    assert.strictEqual(ok.ok, true);

    const unknown = validateAIUIConfig({ changedEventIds: ['event_x'] }, { newEventIds: known });
    assert.strictEqual(unknown.ok, false);
    assert.strictEqual(unknown.failureReasonCode, 'AI_UI_UNKNOWN_EVENT_ID');
  });

  await record('ui: removedEventIds 语义 —— 必须来自旧计划且已不在新计划', () => {
    const previousEventIds = new Set(['old_1', 'old_2']);
    const newEventIds = new Set(['old_1']);

    const valid = validateAIUIConfig(
      { removedEventIds: ['old_2'] },
      { previousEventIds, newEventIds, allowRemovals: true },
    );
    assert.strictEqual(valid.ok, true, 'old_2 已从新计划移除，合法');

    const notInPrevious = validateAIUIConfig(
      { removedEventIds: ['ghost'] },
      { previousEventIds, newEventIds, allowRemovals: true },
    );
    assert.strictEqual(notInPrevious.failureReasonCode, 'AI_UI_UNKNOWN_EVENT_ID');

    const stillPresent = validateAIUIConfig(
      { removedEventIds: ['old_1'] },
      { previousEventIds, newEventIds, allowRemovals: true },
    );
    assert.strictEqual(
      stillPresent.failureReasonCode,
      'AI_UI_REMOVED_EVENT_STILL_PRESENT',
      '仍存在于新计划却声称被移除属自相矛盾',
    );
  });

  await record('ui: INITIAL_GENERATION 不得声明 changed/highlight/removed（首版无旧计划）', () => {
    const removal = validateFor('INITIAL_GENERATION', {
      ...envelopeFor('INITIAL_GENERATION'),
      ui: { removedEventIds: ['whatever'] },
    });
    assert.strictEqual(removal.ok, false, '首版不存在被移除的条目');

    const changed = validateFor('INITIAL_GENERATION', {
      ...envelopeFor('INITIAL_GENERATION'),
      ui: { changedEventIds: ['event_x'] },
    });
    assert.strictEqual(changed.ok, false, '首版 event id 由服务端生成，AI 无从引用');
    assert.strictEqual(changed.failureReasonCode, 'AI_UI_UNKNOWN_EVENT_ID');
  });

  // ---------- message 纯文本约束 ----------

  await record('ui: message 必须是纯文本 —— 拒绝 HTML / 脚本 / 实体注入', () => {
    for (const message of [
      '<script>alert(1)</script>',
      '晚餐已更新 <b>粤菜</b>',
      '&lt;script&gt;',
      '点击 <a href="x">这里</a>',
    ]) {
      const result = validateAIUIConfig({ message });
      assert.strictEqual(result.ok, false, `富文本/标记必须被拒绝：${message}`);
      assert.strictEqual(result.failureReasonCode, 'AI_UI_MESSAGE_MARKUP_FORBIDDEN');
    }
  });

  await record('ui: message 超长 / 非字符串 / 控制字符拒绝，合法文本被 trim', () => {
    assert.strictEqual(
      validateAIUIConfig({ message: 'x'.repeat(AI_UI_MAX_MESSAGE_LENGTH + 1) }).failureReasonCode,
      'AI_UI_MESSAGE_TOO_LONG',
    );
    assert.strictEqual(
      validateAIUIConfig({ message: 123 }).failureReasonCode,
      'AI_UI_MESSAGE_NOT_STRING',
    );
    assert.strictEqual(
      validateAIUIConfig({ message: `晚餐已更新${String.fromCharCode(7)}` }).failureReasonCode,
      'AI_UI_MESSAGE_CONTROL_CHAR_FORBIDDEN',
    );

    const ok = validateAIUIConfig({ message: '  晚餐已改为粤菜  ' });
    assert.strictEqual(ok.ok, true);
    assert.strictEqual(ok.ui!.message, '晚餐已改为粤菜');

    const blank = validateAIUIConfig({ message: '   ' });
    assert.strictEqual(blank.ok, true);
    assert.strictEqual(blank.ui!.message, null, '空白 message 归一化为 null');
  });

  await record('ui: null / undefined 归一化为安全空值', () => {
    assert.deepStrictEqual(validateAIUIConfig(undefined).ui, emptyAIUIConfig());
    assert.deepStrictEqual(validateAIUIConfig(null).ui, emptyAIUIConfig());
    assert.strictEqual(validateAIUIConfig([]).failureReasonCode, 'AI_UI_OBJECT_REQUIRED');
    assert.strictEqual(validateAIUIConfig('x').failureReasonCode, 'AI_UI_OBJECT_REQUIRED');
  });
}
