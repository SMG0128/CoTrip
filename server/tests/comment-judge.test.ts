// AI Trip Pipeline V2 · JudgeAgent 确定性判定测试。
//
// 覆盖：
// - 放行原则：只要存在可执行的 trip-related signal（地点/时长/顺序词/动作词/预算/餐饮/查询），
//   就应该放行；「复杂 / 多动作 / 省略主语 / 依赖上下文 / 找不到精确 POI」都不得判为未解析。
// - 拒绝原则：纯噪音 / 寒暄 / 天气类话题 / 空输入不放行。
// - 确定性兜底：即使 LLM 保守判为 relevant=false / usable=false / updateRequired=false，
//   复杂但有效的行程表达仍应 shouldForward=true，且 updateRequired 兜底为 true。
// - 记录构造：buildCommentEvaluationRecord 输出 JudgeAgent 最终语义（shouldForward/judgeStatus/intentDomain/signals）。

import assert from 'assert';
import { record } from './run-tests';
import {
  deriveJudgeResult,
  detectTripSignals,
  hasExplicitPlanChangeSignal,
  judgeShouldForward,
} from '../src/services/comment-judge';
import { buildCommentEvaluationRecord } from '../src/services/comment-evaluation-ai-validation';
import { AICommentEvaluationEnvelope } from '../src/types/ai-comment-evaluation';
import { emptyAIUIConfig } from '../src/types/ai-envelope';

function envelopeFor(decision: {
  relevant: boolean;
  usable: boolean;
  updateRequired: boolean;
}): AICommentEvaluationEnvelope {
  return {
    schemaVersion: '1.0',
    requestType: 'COMMENT_EVALUATION',
    status: 'success',
    analysis: { commentIntent: '测试意图' },
    decision: { ...decision, reason: '测试理由' },
    trip: null,
    ui: emptyAIUIConfig(),
    meta: {},
  };
}

export async function runCommentJudgeTests(): Promise<void> {
  // ---------- 放行原则：复杂但有效的行程表达一律放行 ----------

  const forwardCases: Array<{ text: string; label: string }> = [
    { text: '去省博', label: '省略全称的简单地点' },
    { text: '看两个小时书再去省博看一个小时再走', label: '核心问题：复合多动作 + 省略主语' },
    { text: '去越秀公园前先去省博', label: '顺序词 + 两个地点' },
    { text: '把越秀公园删了', label: 'DELETE 意图' },
    { text: '把北京路安排到最后', label: 'MOVE 意图' },
    { text: '预算改成300', label: '预算约束' },
    { text: '我在广图再看两个小时', label: '依赖当前行程上下文的时长修改' },
    { text: '先去省博再去越秀公园', label: '复合顺序地点' },
    { text: '吃完饭去北京路逛一下再回酒店', label: '复合动作链' },
    { text: '我想在广图多待一个小时', label: '时长修改' },
    { text: '把省博换成广州塔', label: '替换地点' },
    { text: '我下午有什么安排？', label: '纯查询型（READ）' },
    { text: '现在计划里有省博吗？', label: '纯查询型（READ，省略地点全称）' },
  ];

  for (const testCase of forwardCases) {
    await record(`judge forward: 放行「${testCase.label}」（${testCase.text}）`, () => {
      const result = judgeShouldForward(testCase.text);
      assert.strictEqual(result.shouldForward, true, `${testCase.text} 必须放行`);
      assert.strictEqual(result.status, 'actionable');
      assert.strictEqual(result.intentDomain, 'trip');
      assert.ok(result.reason.length > 0);
    });
  }

  // ---------- 拒绝原则 ----------

  const rejectCases: Array<{ text: string; label: string; status?: string }> = [
    { text: '', label: '空输入' },
    { text: '哈哈哈哈', label: '纯噪音', status: 'irrelevant' },
    { text: '嘿嘿嘿', label: '纯表情', status: 'irrelevant' },
    { text: '你好', label: '寒暄' },
    { text: '好的', label: '确认' },
    { text: '今天天气真不错', label: '天气类话题', status: 'unsupported' },
    { text: '越秀公园风景真好', label: '纯反馈（无修改/查询/理解意图）' },
  ];

  for (const testCase of rejectCases) {
    await record(`judge reject: 拒绝「${testCase.label}」（${testCase.text || '<空>'}）`, () => {
      const result = judgeShouldForward(testCase.text);
      assert.strictEqual(result.shouldForward, false, `${testCase.text} 不得放行`);
      if (testCase.status) assert.strictEqual(result.status, testCase.status);
    });
  }

  // ---------- 信号抽取 ----------

  await record('judge signals: 抽取核心问题句的地点/时长/顺序/动作信号', () => {
    const signals = detectTripSignals('看两个小时书再去省博看一个小时再走');
    assert.ok(
      signals.places.includes('广东省博物馆'),
      `地点信号应归一化为全称：实际 ${JSON.stringify(signals.places)}`,
    );
    assert.ok(signals.durationExpressions.length >= 2, '应抽到两个时长表达');
    assert.ok(signals.sequenceWords.includes('再'), '应抽到顺序词「再」');
    assert.ok(signals.actionWords.includes('看'), '应抽到动作词「看」');
  });

  await record('judge signals: 越秀公园后缀匹配（把越秀公园删了）', () => {
    const signals = detectTripSignals('把越秀公园删了');
    assert.ok(signals.places.includes('越秀公园'), `实际 ${JSON.stringify(signals.places)}`);
  });

  // ---------- 确定性兜底 ----------

  await record(
    'judge override: LLM 保守判为不可用 + updateRequired=false 时，核心问题句仍应放行且兜底 updateRequired=true',
    () => {
      const conservative = { relevant: false, usable: false, updateRequired: false };
      const text = '看两个小时书再去省博看一个小时再走';
      const result = deriveJudgeResult(conservative, text);
      assert.strictEqual(result.shouldForward, true, '确定性信号必须兜底放行');
      assert.strictEqual(result.status, 'actionable');
      assert.strictEqual(result.intentDomain, 'trip');

      const signals = detectTripSignals(text);
      assert.strictEqual(
        hasExplicitPlanChangeSignal(signals, text),
        true,
        '复合顺序表达（地点 + 时长 + 顺序词）必须触发 updateRequired 兜底',
      );
    },
  );

  await record('judge override: 纯反馈（越秀公园风景真好）不触发 updateRequired 兜底', () => {
    const text = '越秀公园风景真好';
    const signals = detectTripSignals(text);
    assert.strictEqual(
      hasExplicitPlanChangeSignal(signals, text),
      false,
      '无修改类信号的评论绝不强制改计划',
    );
  });

  await record('judge override: 看起来不错 / 好的 不得被兜底放行', () => {
    for (const text of ['看起来不错', '好的', '今天作业好多']) {
      const result = deriveJudgeResult({ relevant: false, usable: false, updateRequired: false }, text);
      assert.strictEqual(result.shouldForward, false, `${text} 不得被兜底放行`);
    }
  });

  // ---------- 记录构造 ----------

  await record('judge record: buildCommentEvaluationRecord 输出最终 JudgeAgent 语义', () => {
    const record1 = buildCommentEvaluationRecord(
      envelopeFor({ relevant: true, usable: true, updateRequired: true }),
      '2026-09-01T00:00:00.000Z',
      '去省博',
    );
    assert.strictEqual(record1.status, 'evaluated');
    if (record1.status !== 'evaluated') return;
    assert.strictEqual(record1.shouldForward, true);
    assert.strictEqual(record1.judgeStatus, 'actionable');
    assert.strictEqual(record1.intentDomain, 'trip');
    assert.ok(record1.signals.places.length >= 1);

    const record2 = buildCommentEvaluationRecord(
      envelopeFor({ relevant: false, usable: false, updateRequired: false }),
      '2026-09-01T00:00:00.000Z',
      '哈哈哈哈',
    );
    assert.strictEqual(record2.status, 'evaluated');
    if (record2.status !== 'evaluated') return;
    assert.strictEqual(record2.shouldForward, false);
    assert.strictEqual(record2.judgeStatus, 'irrelevant');
    assert.strictEqual(record2.intentDomain, 'non_trip');

    const record3 = buildCommentEvaluationRecord(
      envelopeFor({ relevant: false, usable: false, updateRequired: false }),
      '2026-09-01T00:00:00.000Z',
      '看两个小时书再去省博看一个小时再走',
    );
    assert.strictEqual(record3.status, 'evaluated');
    if (record3.status !== 'evaluated') return;
    assert.strictEqual(record3.shouldForward, true, '确定性兜底必须体现在最终记录上');
    assert.strictEqual(record3.judgeStatus, 'actionable');
  });
}
