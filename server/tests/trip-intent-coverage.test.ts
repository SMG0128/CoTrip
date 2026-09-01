// trip-intent-coverage.test.ts
// 原子意图覆盖测试（C/D/N/O 节）。
//
// 覆盖：
//   N. 复合意图拆分：「十点到广州图书馆…然后去粤博…再去越秀」→ 3 个 atomic intents，
//      顺序 i1→i2→i3 必须保留、i2（粤博）绝不丢失、afterIntentId 链完整；
//      无标点分隔的「去粤博参观一下再去越秀」也必须拆出完整 3 意图。
//   O. 覆盖投影：3/3 → INCORPORATED；2/3 → PARTIALLY_INCORPORATED；0/3 → UNRESOLVED
//      （绝不能因 3 个中 1 个成功就显示「已纳入计划」）；
//      projectCommentCoverage 映射 aiStatus：accepted / partially_incorporated / unresolved；
//      无 plan 时不做覆盖投影（保留既有 accepted 状态）。

import assert from 'assert';
import { record } from './run-tests';
import {
  AtomicIntent,
  computeIntentCoverage,
  projectCommentCoverage,
  splitCommentIntoAtomicIntents,
} from '../src/services/comment-intent-coverage';
import { Comment } from '../src/types/comment';
import { TripPlan, TripPlanEvent } from '../src/types/trip-plan';

const TZ = 'Asia/Shanghai';

function makeEvent(overrides: Partial<TripPlanEvent> = {}): TripPlanEvent {
  return {
    id: 'event_1',
    type: 'OTHER',
    title: '广州图书馆看书',
    time: { start: '2026-09-10T10:00:00+08:00', timezone: TZ },
    ...overrides,
  };
}

/** 覆盖 广州图书馆 / 广东省博物馆 / 越秀公园 三个地点的计划 */
function coveragePlan(): TripPlan {
  return {
    id: 'plan_trip_N_v1',
    tripId: 'trip_N',
    version: 1,
    events: [
      makeEvent({
        id: 'event_1',
        title: '广州图书馆看书',
        location: {
          id: 'poi_lib',
          name: '广州图书馆',
          latitude: 23.1194,
          longitude: 113.3261,
          address: '广东省广州市天河区珠江东路4号',
        },
      }),
      makeEvent({
        id: 'event_2',
        type: 'OTHER',
        title: '参观省博物馆',
        time: { start: '2026-09-10T13:00:00+08:00', timezone: TZ },
        location: {
          id: 'poi_museum',
          name: '广东省博物馆',
          latitude: 23.1141,
          longitude: 113.3215,
          address: '广东省广州市天河区珠江东路2号',
        },
      }),
      makeEvent({
        id: 'event_3',
        type: 'OTHER',
        title: '越秀公园',
        time: { start: '2026-09-10T16:00:00+08:00', timezone: TZ },
        location: {
          id: 'poi_yuexiu',
          name: '越秀公园',
          latitude: 23.138,
          longitude: 113.265,
          address: '广东省广州市越秀区解放北路988号',
        },
      }),
    ],
    satisfiedConstraintCount: 0,
    totalConstraintCount: 0,
    conflicts: [],
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'comment_N_1',
    tripId: 'trip_N',
    userId: 'user_1',
    rawText: '十点到广州图书馆看书1小时，然后去粤博参观，再去越秀公园。',
    createdAt: '2026-09-01T08:00:00.000Z',
    aiStatus: 'accepted',
    aiSource: 'none',
    ...overrides,
  };
}

export async function runIntentCoverageTests(): Promise<void> {
  // ---------- N. 复合意图拆分：不丢中间意图、顺序与链完整 ----------
  await record('N. 「广图…粤博…越秀」→ 3 intents 顺序 1→2→3，不丢粤博，afterIntentId 链完整', async () => {
    const intents = splitCommentIntoAtomicIntents('十点到广州图书馆看书1小时，然后去粤博参观，再去越秀公园。');
    assert.strictEqual(intents.length, 3, `必须拆出 3 个意图，实际 ${intents.length}`);
    assert.strictEqual(intents[0].location, '广州图书馆');
    assert.strictEqual(intents[1].location, '广东省博物馆', '粤博必须归一化且不能丢失');
    assert.strictEqual(intents[2].location, '越秀公园');
    assert.strictEqual(intents[0].afterIntentId, undefined);
    assert.strictEqual(intents[1].afterIntentId, 'i1', '粤博必须在图书馆之后');
    assert.strictEqual(intents[2].afterIntentId, 'i2', '越秀必须在粤博之后');
  });

  await record('N. 无标点「去粤博参观一下再去越秀」→ 仍拆出完整 3 意图（顺序链保留）', async () => {
    const intents = splitCommentIntoAtomicIntents('十点到广州图书馆看书1小时，然后去粤博参观一下再去越秀公园');
    assert.strictEqual(intents.length, 3, `必须拆出 3 个意图，实际 ${intents.length}`);
    assert.deepStrictEqual(
      intents.map((i) => i.location),
      ['广州图书馆', '广东省博物馆', '越秀公园'],
      '顺序必须保持 图书馆→粤博→越秀',
    );
    assert.deepStrictEqual(
      intents.map((i) => i.afterIntentId),
      [undefined, 'i1', 'i2'],
      'afterIntentId 链必须 i1→i2→i3',
    );
  });

  await record('N. 第一条意图带时长+动作 → ACTIVITY（看书1小时 → 60min）', async () => {
    const intents = splitCommentIntoAtomicIntents('十点到广州图书馆看书1小时，然后去粤博参观，再去越秀公园。');
    const first: AtomicIntent = intents[0];
    assert.strictEqual(first.kind, 'ACTIVITY');
    assert.strictEqual(first.action, '看');
    assert.strictEqual(first.durationMinutes, 60, '「看书1小时」必须解析为 60 分钟');
  });

  // ---------- O. 覆盖投影 ----------
  await record('O. 3/3 → INCORPORATED（全计划覆盖 → 已纳入计划）', async () => {
    const plan = coveragePlan();
    const intents = splitCommentIntoAtomicIntents(makeComment().rawText);
    const coverage = computeIntentCoverage(intents, plan);
    assert.ok(coverage, '必须有 coverage');
    assert.strictEqual(coverage!.plannedCount, 3);
    assert.strictEqual(coverage!.totalCount, 3);
    assert.strictEqual(coverage!.incorporation, 'INCORPORATED');
    assert.deepStrictEqual(
      coverage!.entries.map((e) => e.status),
      ['PLANNED', 'PLANNED', 'PLANNED'],
    );
  });

  await record('O. 2/3 → PARTIALLY_INCORPORATED（绝不显示「已纳入计划」）', async () => {
    const plan = coveragePlan();
    plan.events = plan.events.filter((e) => e.id !== 'event_3'); // 计划未覆盖越秀公园
    const intents = splitCommentIntoAtomicIntents(makeComment().rawText);
    const coverage = computeIntentCoverage(intents, plan);
    assert.ok(coverage, '必须有 coverage');
    assert.strictEqual(coverage!.plannedCount, 2, '只有 2 个意图被覆盖');
    assert.strictEqual(coverage!.totalCount, 3);
    assert.strictEqual(coverage!.incorporation, 'PARTIALLY_INCORPORATED');
    assert.strictEqual(
      coverage!.entries[2].status,
      'UNRESOLVED',
      '未覆盖的越秀公园必须标记为 UNRESOLVED',
    );
    assert.notStrictEqual(coverage!.incorporation, 'INCORPORATED');
  });

  await record('O. 0/3 → UNRESOLVED（1 个都不实现绝不为 INCORPORATED）', async () => {
    const plan = coveragePlan();
    plan.events = []; // 计划尚无任何事件
    const intents = splitCommentIntoAtomicIntents(makeComment().rawText);
    const coverage = computeIntentCoverage(intents, plan);
    assert.ok(coverage, '必须有 coverage');
    assert.strictEqual(coverage!.plannedCount, 0);
    assert.strictEqual(coverage!.incorporation, 'UNRESOLVED');
    assert.notStrictEqual(coverage!.incorporation, 'INCORPORATED');
    assert.notStrictEqual(coverage!.incorporation, 'PARTIALLY_INCORPORATED');
  });

  await record('O. projectCommentCoverage：全覆盖 → aiStatus=accepted', async () => {
    const projected = projectCommentCoverage(makeComment(), coveragePlan());
    assert.strictEqual(projected.aiStatus, 'accepted');
    assert.strictEqual(projected.intentCoverage?.incorporation, 'INCORPORATED');
  });

  await record('O. projectCommentCoverage：部分覆盖 → aiStatus=partially_incorporated', async () => {
    const plan = coveragePlan();
    plan.events = plan.events.filter((e) => e.id !== 'event_3');
    const projected = projectCommentCoverage(makeComment(), plan);
    assert.strictEqual(projected.aiStatus, 'partially_incorporated');
    assert.strictEqual(projected.intentCoverage?.incorporation, 'PARTIALLY_INCORPORATED');
    assert.strictEqual(projected.intentCoverage?.plannedCount, 2);
  });

  await record('O. projectCommentCoverage：0 覆盖 → aiStatus=unresolved（不是 accepted）', async () => {
    const plan = coveragePlan();
    plan.events = [];
    const projected = projectCommentCoverage(makeComment({ aiStatus: 'accepted' }), plan);
    assert.strictEqual(projected.aiStatus, 'unresolved');
    assert.strictEqual(projected.intentCoverage?.incorporation, 'UNRESOLVED');
  });

  await record('O. 无 plan → 不投影：既有 accepted 保留（约束已采纳 ≠ 计划覆盖）', async () => {
    const comment = makeComment({ aiStatus: 'accepted' });
    const projected = projectCommentCoverage(comment, undefined);
    assert.strictEqual(projected, comment, '无计划时必须原样返回，不做覆盖误判');
    assert.strictEqual(projected.aiStatus, 'accepted');
    assert.strictEqual(projected.intentCoverage, undefined);
  });
}
