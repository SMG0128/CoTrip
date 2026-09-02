// AI Trip Pipeline V2 · PlanAgent 职责边界测试。
//
// 架构原则（本次调整的核心）：
//   JudgeAgent 只负责「是否放行」（shouldForward + 最小解析状态）；
//   PlanAgent（TRIP_UPDATE）负责真正理解用户意图，并对计划做 ADD / UPDATE / DELETE / MOVE。
//
// 覆盖：
// - Judge → PlanAgent 贯通：确定性信号兜底放行（LLM 保守判为 relevant=false/usable=false/
//   updateRequired=false 时，复杂但有效的行程表达仍进入 TRIP_UPDATE）。
// - PlanAgent 操作识别：ADD / UPDATE / DELETE / MOVE 通过完整 snapshot 表达，落库后
//   用 diffTripPlans 收敛为最小操作集合（可观测性 + 职责证明）。
// - 核心问题句：看两个小时书再去省博看一个小时再走 → [update(广图), add(省博)]，绝无 delete。
// - 顺序词理解：去越秀公园前先去省博 → 新增活动插在越秀公园之前。
// - 回归：看起来不错（updateRequired=false）绝不调用 TRIP_UPDATE。
//
// 不 mock 仓库：真实 JSON 落盘，每个用例独立临时目录；AI 一律使用可编程 stub。
// postProcessor 不注入（与现有 stage3 测试一致），diff 结果干净可预测。

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { JsonTripRepository } from '../src/repositories/json-trip-repository';
import { JsonCommentRepository } from '../src/repositories/json-comment-repository';
import { JsonUserRepository } from '../src/repositories/json-user-repository';
import { CommentService } from '../src/services/comment-service';
import { UnavailableAICommentService } from '../src/services/ai-comment-service';
import { TripPlanGenerationService } from '../src/services/trip-plan-generation-service';
import {
  CommentEvaluationAIService,
  UnavailableCommentEvaluationAIService,
} from '../src/services/comment-evaluation-ai-service';
import { UnavailableInitialGenerationAIService } from '../src/services/initial-generation-ai-service';
import {
  TripUpdateAIError,
  TripUpdateAIService,
  UnavailableTripUpdateAIService,
} from '../src/services/trip-update-ai-service';
import {
  AICommentEvaluationEnvelope,
  CommentEvaluationAIInput,
} from '../src/types/ai-comment-evaluation';
import { AITripUpdateEnvelope, TripUpdateAIInput } from '../src/types/ai-trip-update';
import { emptyAIUIConfig } from '../src/types/ai-envelope';
import { Trip } from '../src/types/trip';
import { TripPlan } from '../src/types/trip-plan';
import { TripAIContext } from '../src/types/ai-preprocess';
import { User } from '../src/types/user';
import { diffTripPlans } from '../src/services/trip-plan-diff';
import { record } from './run-tests';

const userA: User = {
  id: 'usr_A',
  wechatOpenId: 'openid_A_private',
  nickname: '真实用户 A',
  avatarUrl: 'https://example.test/a.png',
  profileCompleted: true,
  createdAt: 1,
  updatedAt: 1,
};

const userB: User = {
  id: 'usr_B',
  wechatOpenId: 'openid_B_private',
  nickname: '真实用户 B',
  avatarUrl: 'https://example.test/b.png',
  profileCompleted: true,
  createdAt: 2,
  updatedAt: 2,
};

function aiContextFixture(): TripAIContext {
  return {
    schemaVersion: '1.0',
    requestType: 'PREPROCESS',
    status: 'success',
    createdAt: '2026-08-30T02:00:00.000Z',
    analysis: {
      title: '周末广州游',
      intent: '周末在广州活动并吃饭',
      constraints: { city: '广州' },
      activities: ['看书', '逛公园', '吃饭'],
      missingInformation: [],
    },
    decision: { canGenerateTrip: false },
    trip: null,
    tripInput: { title: '周末广州游', initialBrief: '周末一起在广州玩' },
  };
}

/** 基础计划：广州图书馆(10:00) → 越秀公园(14:00) → 北京路吃饭(18:00) */
function basePlanFixture(): TripPlan {
  return {
    id: 'plan_trip_T_v1',
    tripId: 'trip_T',
    version: 1,
    events: [
      {
        id: 'event_gzlib',
        type: 'ENTERTAINMENT',
        title: '广州图书馆',
        time: { start: '2026-09-05T10:00:00+08:00', timezone: 'Asia/Shanghai' },
      },
      {
        id: 'event_yuexiu',
        type: 'ENTERTAINMENT',
        title: '越秀公园',
        time: { start: '2026-09-05T14:00:00+08:00', timezone: 'Asia/Shanghai' },
      },
      {
        id: 'event_bjroad',
        type: 'DINING',
        title: '北京路吃饭',
        time: { start: '2026-09-05T18:00:00+08:00', timezone: 'Asia/Shanghai' },
      },
    ],
    summary: '第 1 版',
    satisfiedConstraintCount: 0,
    totalConstraintCount: 0,
    conflicts: [],
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

function tripFixture(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip_T',
    title: '周末广州游',
    status: 'ACTIVE',
    creatorId: 'usr_A',
    participantIds: ['usr_A', 'usr_B'],
    createdAt: '2026-08-30T02:00:00.000Z',
    roomCode: 'ABCDEFG',
    initialBrief: '周末一起在广州玩',
    commentIds: [],
    constraintIds: [],
    aiContext: aiContextFixture(),
    currentPlan: basePlanFixture(),
    ...overrides,
  };
}

function evaluationEnvelope(decision: {
  relevant: boolean;
  usable: boolean;
  updateRequired: boolean;
}): AICommentEvaluationEnvelope {
  return {
    schemaVersion: '1.0',
    requestType: 'COMMENT_EVALUATION',
    status: 'success',
    analysis: { commentIntent: '调整安排' },
    decision: { ...decision, reason: '测试理由' },
    trip: null,
    ui: emptyAIUIConfig(),
    meta: {},
  };
}

function stubEvaluationAI(envelope: AICommentEvaluationEnvelope): CommentEvaluationAIService & {
  captured: CommentEvaluationAIInput[];
} {
  const captured: CommentEvaluationAIInput[] = [];
  return {
    source: 'mock' as const,
    captured,
    async evaluateComment(input: CommentEvaluationAIInput) {
      captured.push(input);
      return envelope;
    },
  };
}

interface UpdateStub extends TripUpdateAIService {
  captured: TripUpdateAIInput[];
}

function stubUpdateAI(options: {
  envelope?: AITripUpdateEnvelope;
  envelopeFor?: (input: TripUpdateAIInput) => AITripUpdateEnvelope;
  error?: TripUpdateAIError;
}): UpdateStub {
  const captured: TripUpdateAIInput[] = [];
  return {
    source: 'mock' as const,
    captured,
    async updateTrip(input: TripUpdateAIInput) {
      captured.push(input);
      if (options.error) throw options.error;
      if (options.envelopeFor) return options.envelopeFor(input);
      return options.envelope as AITripUpdateEnvelope;
    },
  };
}

interface Harness {
  directory: string;
  trips: JsonTripRepository;
  comments: JsonCommentRepository;
  service: CommentService;
}

function setup(options: {
  evaluationAI?: CommentEvaluationAIService;
  updateAI?: TripUpdateAIService;
}): Harness {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cotrip-plan-agent-'));
  fs.writeFileSync(
    path.join(directory, 'users.json'),
    JSON.stringify({ users: [userA, userB] }),
    'utf8',
  );
  const trips = new JsonTripRepository(path.join(directory, 'trips.json'));
  const comments = new JsonCommentRepository(path.join(directory, 'comments.json'));
  const users = new JsonUserRepository(path.join(directory, 'users.json'));
  const planGeneration = new TripPlanGenerationService(
    trips,
    options.evaluationAI ?? new UnavailableCommentEvaluationAIService(),
    new UnavailableInitialGenerationAIService(),
    options.updateAI ?? new UnavailableTripUpdateAIService(),
  );
  const service = new CommentService(
    comments,
    trips,
    users,
    new UnavailableAICommentService(),
    undefined,
    planGeneration,
  );
  return { directory, trips, comments, service };
}

/** 基于旧计划构造合法 TRIP_UPDATE envelope：旧条目沿用真实 id，新条目省略 id */
function updateEnvelope(
  basePlan: TripPlan,
  items: AITripUpdateEnvelope['trip']['items'],
  message: string,
): AITripUpdateEnvelope {
  return {
    schemaVersion: '1.0',
    requestType: 'TRIP_UPDATE',
    status: 'success',
    analysis: {},
    decision: { tripChanged: true },
    trip: { title: '周末广州游', summary: `基于 v${basePlan.version} 的更新`, items },
    ui: { ...emptyAIUIConfig(), message },
    meta: {},
  };
}

function keep(basePlan: TripPlan, eventId: string, overrides: Partial<{ time: unknown; title: string }> = {}) {
  const event = basePlan.events.find((e) => e.id === eventId);
  assert.ok(event, `fixture 事件 ${eventId} 必须存在`);
  return {
    id: event.id,
    type: event.type,
    title: overrides.title ?? event.title,
    time: (overrides.time ?? event.time) as never,
  };
}

export async function runTripPlanAgentTests(): Promise<void> {
  // ---------- Judge → PlanAgent 贯通：确定性兜底放行 ----------

  await record(
    'plan-agent: LLM 保守判为不可用 + updateRequired=false 时，核心问题句仍进入 TRIP_UPDATE（兜底放行）',
    async () => {
      const evaluationAI = stubEvaluationAI(
        evaluationEnvelope({ relevant: false, usable: false, updateRequired: false }),
      );
      // PlanAgent 正确理解意图：广图时长 10:00→12:00，之后新增省博 12:00→13:00，后续活动保留
      const updateAI = stubUpdateAI({
        envelopeFor: (input) =>
          updateEnvelope(input.currentPlan, [
            keep(input.currentPlan, 'event_gzlib', {
              time: { start: '2026-09-05T10:00:00+08:00', end: '2026-09-05T12:00:00+08:00', timezone: 'Asia/Shanghai' },
            }),
            {
              type: 'ENTERTAINMENT',
              title: '省博',
              time: { start: '2026-09-05T12:00:00+08:00', end: '2026-09-05T13:00:00+08:00', timezone: 'Asia/Shanghai' },
            },
            keep(input.currentPlan, 'event_yuexiu'),
            keep(input.currentPlan, 'event_bjroad'),
          ], '已调整广图时长并新增省博'),
      });
      const { directory, trips, service } = setup({ evaluationAI, updateAI });
      try {
        await trips.create(tripFixture());
        await service.addComment('usr_A', 'trip_T', '看两个小时书再去省博看一个小时再走');

        // Judge → PlanAgent 输入贯通：放行语义必须随评论判断结果送入 TRIP_UPDATE
        assert.strictEqual(updateAI.captured.length, 1, '必须恰好调用一次 TRIP_UPDATE');
        const evaluation = updateAI.captured[0].commentEvaluation;
        assert.strictEqual(evaluation.shouldForward, true, 'Judge 最终放行语义 must be true');
        assert.strictEqual(evaluation.judgeStatus, 'actionable');
        assert.strictEqual(evaluation.intentDomain, 'trip');

        // PlanAgent 操作：update(广图 time) + add(省博，插在广图之后)，绝无 delete
        const trip = await trips.findById('trip_T');
        assert.strictEqual(trip!.currentPlan!.version, 2, '必须产出 v2');
        const ops = diffTripPlans(basePlanFixture(), trip!.currentPlan!);
        const addOps = ops.filter((op) => op.type === 'add');
        const updateOps = ops.filter((op) => op.type === 'update');
        const deleteOps = ops.filter((op) => op.type === 'delete');

        assert.strictEqual(deleteOps.length, 0, '复合指令绝不误删活动');
        assert.strictEqual(addOps.length, 1, '必须新增省博');
        assert.strictEqual(addOps[0].title, '省博');
        assert.strictEqual(addOps[0].afterEventId, 'event_gzlib', '省博必须插在广图之后');
        assert.ok(
          updateOps.some((op) => op.eventId === 'event_gzlib' && op.changedFields.includes('time')),
          '广图时长必须被更新',
        );
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  // ---------- PlanAgent 完整增删改查能力 ----------

  await record('plan-agent: ADD ——「去省博」新增活动并保留既有活动', async () => {
    const evaluationAI = stubEvaluationAI(
      evaluationEnvelope({ relevant: true, usable: true, updateRequired: true }),
    );
    const updateAI = stubUpdateAI({
      envelopeFor: (input) =>
        updateEnvelope(input.currentPlan, [
          keep(input.currentPlan, 'event_gzlib'),
          { type: 'ENTERTAINMENT', title: '省博', time: { start: '2026-09-05T12:00:00+08:00', timezone: 'Asia/Shanghai' } },
          keep(input.currentPlan, 'event_yuexiu'),
          keep(input.currentPlan, 'event_bjroad'),
        ], '已新增省博'),
    });
    const { directory, trips, service } = setup({ evaluationAI, updateAI });
    try {
      await trips.create(tripFixture());
      await service.addComment('usr_A', 'trip_T', '去省博');

      const trip = await trips.findById('trip_T');
      const ops = diffTripPlans(basePlanFixture(), trip!.currentPlan!);
      const addOps = ops.filter((op) => op.type === 'add');
      assert.strictEqual(addOps.length, 1);
      assert.strictEqual(addOps[0].title, '省博');
      assert.strictEqual(trip!.currentPlan!.events.length, 4);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  await record('plan-agent: DELETE ——「把越秀公园删了」移除活动', async () => {
    const evaluationAI = stubEvaluationAI(
      evaluationEnvelope({ relevant: true, usable: true, updateRequired: true }),
    );
    const updateAI = stubUpdateAI({
      envelopeFor: (input) =>
        updateEnvelope(input.currentPlan, [
          keep(input.currentPlan, 'event_gzlib'),
          keep(input.currentPlan, 'event_bjroad'),
        ], '已删除越秀公园'),
    });
    const { directory, trips, service } = setup({ evaluationAI, updateAI });
    try {
      await trips.create(tripFixture());
      await service.addComment('usr_A', 'trip_T', '把越秀公园删了');

      const trip = await trips.findById('trip_T');
      const ops = diffTripPlans(basePlanFixture(), trip!.currentPlan!);
      const deleteOps = ops.filter((op) => op.type === 'delete');
      assert.strictEqual(deleteOps.length, 1);
      assert.strictEqual(deleteOps[0].eventId, 'event_yuexiu');
      assert.strictEqual(trip!.currentPlan!.events.length, 2);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  await record('plan-agent: UPDATE ——「我在广图再看两个小时」修改活动时长', async () => {
    const evaluationAI = stubEvaluationAI(
      evaluationEnvelope({ relevant: true, usable: true, updateRequired: true }),
    );
    const updateAI = stubUpdateAI({
      envelopeFor: (input) =>
        updateEnvelope(input.currentPlan, [
          keep(input.currentPlan, 'event_gzlib', {
            time: { start: '2026-09-05T10:00:00+08:00', end: '2026-09-05T12:00:00+08:00', timezone: 'Asia/Shanghai' },
          }),
          keep(input.currentPlan, 'event_yuexiu'),
          keep(input.currentPlan, 'event_bjroad'),
        ], '广图时长已延长'),
    });
    const { directory, trips, service } = setup({ evaluationAI, updateAI });
    try {
      await trips.create(tripFixture());
      await service.addComment('usr_A', 'trip_T', '我在广图再看两个小时');

      const trip = await trips.findById('trip_T');
      const ops = diffTripPlans(basePlanFixture(), trip!.currentPlan!);
      const updateOps = ops.filter((op) => op.type === 'update');
      assert.ok(
        updateOps.some((op) => op.eventId === 'event_gzlib' && op.changedFields.includes('time')),
        '广图 time 必须被更新',
      );
      assert.strictEqual(trip!.currentPlan!.events.length, 3);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  await record('plan-agent: MOVE ——「把越秀公园安排到最后」重排活动顺序', async () => {
    const evaluationAI = stubEvaluationAI(
      evaluationEnvelope({ relevant: true, usable: true, updateRequired: true }),
    );
    const updateAI = stubUpdateAI({
      envelopeFor: (input) =>
        updateEnvelope(input.currentPlan, [
          keep(input.currentPlan, 'event_gzlib'),
          keep(input.currentPlan, 'event_bjroad'),
          keep(input.currentPlan, 'event_yuexiu'),
        ], '已把越秀公园移到最后'),
    });
    const { directory, trips, service } = setup({ evaluationAI, updateAI });
    try {
      await trips.create(tripFixture());
      await service.addComment('usr_A', 'trip_T', '把越秀公园安排到最后');

      const trip = await trips.findById('trip_T');
      const ops = diffTripPlans(basePlanFixture(), trip!.currentPlan!);
      const moveOps = ops.filter((op) => op.type === 'move');
      assert.ok(moveOps.some((op) => op.eventId === 'event_yuexiu'), '越秀公园必须产生 move 操作');
      const lastId = trip!.currentPlan!.events[trip!.currentPlan!.events.length - 1].id;
      assert.strictEqual(lastId, 'event_yuexiu', '越秀公园必须排在最后');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  await record('plan-agent: 顺序词 ——「去越秀公园前先去省博」插入到越秀公园之前', async () => {
    const evaluationAI = stubEvaluationAI(
      evaluationEnvelope({ relevant: true, usable: true, updateRequired: true }),
    );
    const updateAI = stubUpdateAI({
      envelopeFor: (input) =>
        updateEnvelope(input.currentPlan, [
          keep(input.currentPlan, 'event_gzlib'),
          { type: 'ENTERTAINMENT', title: '省博', time: { start: '2026-09-05T12:00:00+08:00', timezone: 'Asia/Shanghai' } },
          keep(input.currentPlan, 'event_yuexiu'),
          keep(input.currentPlan, 'event_bjroad'),
        ], '已在越秀公园之前新增省博'),
    });
    const { directory, trips, service } = setup({ evaluationAI, updateAI });
    try {
      await trips.create(tripFixture());
      await service.addComment('usr_A', 'trip_T', '去越秀公园前先去省博');

      const trip = await trips.findById('trip_T');
      const ops = diffTripPlans(basePlanFixture(), trip!.currentPlan!);
      const addOps = ops.filter((op) => op.type === 'add');
      assert.strictEqual(addOps.length, 1);
      assert.strictEqual(addOps[0].afterEventId, 'event_gzlib', '省博插在广图之后、越秀公园之前');
      const order = trip!.currentPlan!.events.map((e) => e.id);
      assert.deepStrictEqual(order, ['event_gzlib', trip!.currentPlan!.events[1].id, 'event_yuexiu', 'event_bjroad']);
      assert.ok(order.indexOf('event_yuexiu') > order.indexOf(trip!.currentPlan!.events[1].id));
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  // ---------- 回归：不放大修改范围 ----------

  await record('plan-agent regression: 「看起来不错」（updateRequired=false）绝不调用 TRIP_UPDATE', async () => {
    const evaluationAI = stubEvaluationAI(
      evaluationEnvelope({ relevant: true, usable: true, updateRequired: false }),
    );
    const updateAI = stubUpdateAI({ envelope: updateEnvelope(basePlanFixture(), [], '') });
    const { directory, trips, service } = setup({ evaluationAI, updateAI });
    try {
      await trips.create(tripFixture());
      await service.addComment('usr_A', 'trip_T', '看起来不错');

      assert.strictEqual(updateAI.captured.length, 0, 'updateRequired=false 绝不触发更新');
      const trip = await trips.findById('trip_T');
      assert.strictEqual(trip!.currentPlan!.version, 1, 'currentPlan 必须完全不变');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  await record('plan-agent regression: 纯反馈「越秀公园风景真好」不触发 TRIP_UPDATE', async () => {
    const evaluationAI = stubEvaluationAI(
      evaluationEnvelope({ relevant: false, usable: false, updateRequired: false }),
    );
    const updateAI = stubUpdateAI({ envelope: updateEnvelope(basePlanFixture(), [], '') });
    const { directory, trips, service } = setup({ evaluationAI, updateAI });
    try {
      await trips.create(tripFixture());
      await service.addComment('usr_A', 'trip_T', '越秀公园风景真好');

      assert.strictEqual(updateAI.captured.length, 0, '纯反馈不得触发计划修改');
      const trip = await trips.findById('trip_T');
      assert.strictEqual(trip!.currentPlan!.version, 1);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
}
