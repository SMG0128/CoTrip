// AI Trip Pipeline V2 · Stage 3 · TRIP_UPDATE 测试。
//
// 覆盖：
// - 触发闸门：只有 relevant && usable && updateRequired 才允许更新
// - 输入贯通：title / tripInput / aiContext / currentPlan / triggeringComment / commentEvaluation
// - 完整 snapshot 落库 + version 严格递增（v1 → v2 → v3）
// - 非法响应（requestType / schemaVersion / trip=null / tripChanged=false / schema /
//   真实世界事实 / ui 非法）一律拒绝，currentPlan 保持旧版本
// - AI 不可用不得影响评论与评估保存
// - 并发：版本 compare-and-set，过期结果绝不覆盖新版本，无 lost update
//
// 不 mock 仓库：真实 JSON 落盘，每个用例独立临时目录；AI 一律使用可编程 stub。

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
import {
  InitialGenerationAIService,
  UnavailableInitialGenerationAIService,
} from '../src/services/initial-generation-ai-service';
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
      title: '周末羽毛球局',
      intent: '周末和朋友打羽毛球并吃饭',
      constraints: { city: '广州' },
      activities: ['羽毛球', '聚餐'],
      missingInformation: [],
    },
    decision: { canGenerateTrip: false },
    trip: null,
    tripInput: { title: '周末羽毛球局', initialBrief: '周末约球顺便吃个饭' },
  };
}

function planFixture(version = 1): TripPlan {
  return {
    id: `plan_trip_T_v${version}`,
    tripId: 'trip_T',
    version,
    events: [
      {
        id: `event_trip_T_${version}_1`,
        type: 'SPORT',
        title: '羽毛球',
        time: { start: '2026-09-05T15:00:00+08:00', timezone: 'Asia/Shanghai' },
      },
      {
        id: `event_trip_T_${version}_2`,
        type: 'DINING',
        title: '晚餐（川菜）',
        time: { start: '2026-09-05T18:00:00+08:00', timezone: 'Asia/Shanghai' },
      },
    ],
    summary: `第 ${version} 版`,
    satisfiedConstraintCount: 0,
    totalConstraintCount: 0,
    conflicts: [],
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

function tripFixture(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip_T',
    title: '周末羽毛球局',
    status: 'ACTIVE',
    creatorId: 'usr_A',
    participantIds: ['usr_A', 'usr_B'],
    createdAt: '2026-08-30T02:00:00.000Z',
    roomCode: 'ABCDEFG',
    initialBrief: '周末约球顺便吃个饭',
    commentIds: [],
    constraintIds: [],
    aiContext: aiContextFixture(),
    currentPlan: planFixture(1),
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

/** 基于给定旧计划构造合法更新 envelope：保留第一条（引用旧 id），替换晚餐 */
function updateEnvelopeFor(
  basePlan: TripPlan,
  overrides: Partial<AITripUpdateEnvelope> = {},
): AITripUpdateEnvelope {
  const keptId = basePlan.events[0].id;
  return {
    schemaVersion: '1.0',
    requestType: 'TRIP_UPDATE',
    status: 'success',
    analysis: {},
    decision: { tripChanged: true },
    trip: {
      title: '周末羽毛球局',
      summary: `基于 v${basePlan.version} 的更新`,
      items: [
        {
          id: keptId,
          type: 'SPORT',
          title: '羽毛球',
          time: { start: '2026-09-05T15:00:00+08:00', timezone: 'Asia/Shanghai' },
        },
        {
          type: 'DINING',
          title: '晚餐（粤菜）',
          time: { start: '2026-09-05T18:00:00+08:00', timezone: 'Asia/Shanghai' },
        },
      ],
    },
    ui: { ...emptyAIUIConfig(), message: '晚餐已改为粤菜' },
    meta: {},
    ...overrides,
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
  beforeResolve?: (input: TripUpdateAIInput) => Promise<void> | void;
}): UpdateStub {
  const captured: TripUpdateAIInput[] = [];
  return {
    source: 'mock' as const,
    captured,
    async updateTrip(input: TripUpdateAIInput) {
      captured.push(input);
      if (options.beforeResolve) await options.beforeResolve(input);
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
  generationAI?: InitialGenerationAIService;
  updateAI?: TripUpdateAIService;
}): Harness {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cotrip-stage3-'));
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
    options.generationAI ?? new UnavailableInitialGenerationAIService(),
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

export async function runTripUpdateTests(): Promise<void> {
  // ---------- 触发闸门 ----------

  await record('stage3 gate: updateRequired=false 时绝不调用 TRIP_UPDATE，version 不变', async () => {
    const evaluationAI = stubEvaluationAI(
      evaluationEnvelope({ relevant: true, usable: true, updateRequired: false }),
    );
    const updateAI = stubUpdateAI({ envelope: updateEnvelopeFor(planFixture(1)) });
    const { directory, trips, service } = setup({ evaluationAI, updateAI });
    try {
      await trips.create(tripFixture());
      await service.addComment('usr_A', 'trip_T', '看起来不错');

      assert.strictEqual(updateAI.captured.length, 0, 'updateRequired=false 绝不触发更新');
      const trip = await trips.findById('trip_T');
      assert.deepStrictEqual(trip!.currentPlan, planFixture(1), 'currentPlan 必须完全不变');
      assert.strictEqual(trip!.currentPlan!.version, 1, 'version 必须完全不变');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  await record('stage3 gate: 无关评论（relevant=false）绝不调用 TRIP_UPDATE', async () => {
    const evaluationAI = stubEvaluationAI(
      evaluationEnvelope({ relevant: false, usable: false, updateRequired: false }),
    );
    const updateAI = stubUpdateAI({ envelope: updateEnvelopeFor(planFixture(1)) });
    const { directory, trips, service } = setup({ evaluationAI, updateAI });
    try {
      await trips.create(tripFixture());
      await service.addComment('usr_A', 'trip_T', '今天作业好多');

      assert.strictEqual(updateAI.captured.length, 0, '无关评论绝不触发更新');
      const trip = await trips.findById('trip_T');
      assert.deepStrictEqual(trip!.currentPlan, planFixture(1), 'currentPlan 必须不变');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  await record('stage3 gate: relevant 但 unusable 绝不调用 TRIP_UPDATE', async () => {
    const evaluationAI = stubEvaluationAI(
      evaluationEnvelope({ relevant: true, usable: false, updateRequired: true }),
    );
    const updateAI = stubUpdateAI({ envelope: updateEnvelopeFor(planFixture(1)) });
    const { directory, trips, service } = setup({ evaluationAI, updateAI });
    try {
      await trips.create(tripFixture());
      await service.addComment('usr_A', 'trip_T', '好的');

      assert.strictEqual(updateAI.captured.length, 0, 'usable=false 绝不触发更新');
      const trip = await trips.findById('trip_T');
      assert.strictEqual(trip!.currentPlan!.version, 1);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  // ---------- 合法更新 ----------

  await record('stage3 update: 合法评论恰好触发一次 TRIP_UPDATE，输入上下文完整，version → 2', async () => {
    const evaluationAI = stubEvaluationAI(
      evaluationEnvelope({ relevant: true, usable: true, updateRequired: true }),
    );
    const updateAI = stubUpdateAI({
      envelopeFor: (input) => updateEnvelopeFor(input.currentPlan),
    });
    const { directory, trips, service } = setup({ evaluationAI, updateAI });
    try {
      await trips.create(tripFixture());
      await service.addComment('usr_B', 'trip_T', '晚上不要吃辣，改成粤菜');

      assert.strictEqual(updateAI.captured.length, 1, 'TRIP_UPDATE 必须恰好调用一次');
      const input = updateAI.captured[0];
      assert.strictEqual(input.title, '周末羽毛球局', '输入必须含 title');
      assert.strictEqual(
        input.tripInput.initialBrief,
        '周末约球顺便吃个饭',
        '输入必须含创建时原始 tripInput',
      );
      assert.ok(input.aiContext, '输入必须含 aiContext');
      assert.strictEqual(input.currentPlan.version, 1, '输入必须含当前完整 currentPlan');
      assert.strictEqual(input.currentPlan.events.length, 2);
      assert.strictEqual(
        input.triggeringComment.rawText,
        '晚上不要吃辣，改成粤菜',
        '输入必须含触发评论',
      );
      assert.strictEqual(input.commentEvaluation.updateRequired, true, '输入必须含评论判断结果');
      assert.strictEqual(input.baseVersion, 1, '更新必须绑定 baseVersion');
      assert.strictEqual(
        (input.triggeringComment as unknown as { userId?: string }).userId,
        undefined,
        '更新输入不得携带评论作者身份',
      );

      const trip = await trips.findById('trip_T');
      assert.strictEqual(trip!.currentPlan!.version, 2, '成功更新后 version 必须 +1');
      assert.strictEqual(trip!.currentPlan!.events.length, 2, '必须是完整 snapshot');
      assert.strictEqual(
        trip!.currentPlan!.events[0].id,
        'event_trip_T_1_1',
        '被保留的条目必须沿用旧 id',
      );
      assert.strictEqual(trip!.currentPlan!.events[1].title, '晚餐（粤菜）', '新条目必须落库');
      assert.strictEqual(trip!.title, '周末羽毛球局', 'Trip.title 不得被 AI 输出覆盖');

      assert.ok(trip!.latestAIUI, 'UI 提示必须与新计划一起落库');
      assert.strictEqual(trip!.latestAIUI!.planVersion, 2, 'UI 提示必须标记所属计划版本');
      assert.strictEqual(trip!.latestAIUI!.requestType, 'TRIP_UPDATE');
      assert.strictEqual(trip!.latestAIUI!.ui.message, '晚餐已改为粤菜');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  await record('stage3 update: 连续两次合法更新 version 连续递增 v1 → v2 → v3', async () => {
    const evaluationAI = stubEvaluationAI(
      evaluationEnvelope({ relevant: true, usable: true, updateRequired: true }),
    );
    const updateAI = stubUpdateAI({
      envelopeFor: (input) => updateEnvelopeFor(input.currentPlan),
    });
    const { directory, trips, service } = setup({ evaluationAI, updateAI });
    try {
      await trips.create(tripFixture());

      await service.addComment('usr_A', 'trip_T', '晚上改成粤菜');
      const afterFirst = await trips.findById('trip_T');
      assert.strictEqual(afterFirst!.currentPlan!.version, 2);

      await service.addComment('usr_B', 'trip_T', '羽毛球改到四点');
      const afterSecond = await trips.findById('trip_T');
      assert.strictEqual(afterSecond!.currentPlan!.version, 3, 'version 必须连续递增');
      assert.strictEqual(updateAI.captured.length, 2);
      assert.strictEqual(
        updateAI.captured[1].baseVersion,
        2,
        '第二次更新必须基于最新版本 v2',
      );
      assert.strictEqual(afterSecond!.latestAIUI!.planVersion, 3);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  // ---------- 非法响应 ----------

  await record('stage3 update: 非法响应一律拒绝落库，评论与评估仍保存，version 不变', async () => {
    const basePlan = planFixture(1);
    const cases: Array<{ name: string; envelope: AITripUpdateEnvelope }> = [
      {
        name: 'requestType 错',
        envelope: updateEnvelopeFor(basePlan, {
          requestType: 'INITIAL_GENERATION' as never,
        }),
      },
      {
        name: 'schemaVersion 错',
        envelope: updateEnvelopeFor(basePlan, { schemaVersion: '' }),
      },
      {
        name: 'trip=null',
        envelope: updateEnvelopeFor(basePlan, {
          trip: null as unknown as AITripUpdateEnvelope['trip'],
        }),
      },
      {
        name: 'tripChanged=false',
        envelope: updateEnvelopeFor(basePlan, {
          decision: { tripChanged: false } as unknown as AITripUpdateEnvelope['decision'],
        }),
      },
      {
        name: 'trip schema 非法（自然语言时间）',
        envelope: updateEnvelopeFor(basePlan, {
          trip: {
            title: 't',
            summary: 's',
            items: [
              { type: 'SPORT', title: '羽毛球', time: { start: '下午四点', timezone: 'Asia/Shanghai' } },
            ],
          } as never,
        }),
      },
      {
        name: '真实世界事实非法',
        envelope: updateEnvelopeFor(basePlan, {
          trip: {
            title: 't',
            summary: 's',
            items: [
              {
                type: 'DINING',
                title: '晚餐',
                time: { start: '2026-09-05T18:00:00+08:00', timezone: 'Asia/Shanghai' },
                price: { amount: 120, currency: 'CNY' },
              },
            ],
          } as never,
        }),
      },
      {
        name: 'ui 非法（样式字段）',
        envelope: updateEnvelopeFor(basePlan, {
          ui: { changedEventIds: [], color: '#fff' } as never,
        }),
      },
      {
        name: 'ui 非法（引用不存在的 item id）',
        envelope: updateEnvelopeFor(basePlan, {
          ui: { ...emptyAIUIConfig(), changedEventIds: ['event_ghost'] },
        }),
      },
      {
        name: '条目引用不存在的旧 id',
        envelope: updateEnvelopeFor(basePlan, {
          trip: {
            title: 't',
            summary: 's',
            items: [
              {
                id: 'event_never_existed',
                type: 'SPORT',
                title: '羽毛球',
                time: { start: '2026-09-05T16:00:00+08:00', timezone: 'Asia/Shanghai' },
              },
            ],
          } as never,
        }),
      },
    ];

    for (const testCase of cases) {
      const evaluationAI = stubEvaluationAI(
        evaluationEnvelope({ relevant: true, usable: true, updateRequired: true }),
      );
      const updateAI = stubUpdateAI({ envelope: testCase.envelope });
      const { directory, trips, comments, service } = setup({ evaluationAI, updateAI });
      try {
        await trips.create(tripFixture());
        const comment = await service.addComment('usr_A', 'trip_T', '晚上改成粤菜');

        assert.strictEqual(updateAI.captured.length, 1, `${testCase.name}: 更新调用必须已发生`);
        assert.strictEqual(comment.rawText, '晚上改成粤菜', `${testCase.name}: 评论仍必须保存`);

        const stored = await comments.listByTrip('trip_T');
        assert.ok(stored[0].evaluation, `${testCase.name}: 评估记录仍必须保存`);

        const trip = await trips.findById('trip_T');
        assert.deepStrictEqual(
          trip!.currentPlan,
          planFixture(1),
          `${testCase.name}: currentPlan 必须保持旧版本`,
        );
        assert.strictEqual(trip!.latestAIUI, undefined, `${testCase.name}: 不得写入 UI 提示`);
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  // ---------- AI 不可用 ----------

  await record('stage3 degradation: TRIP_UPDATE provider 不可用时评论与评估仍保存，计划不变', async () => {
    const evaluationAI = stubEvaluationAI(
      evaluationEnvelope({ relevant: true, usable: true, updateRequired: true }),
    );
    // updateAI 默认为 Unavailable
    const { directory, trips, comments, service } = setup({ evaluationAI });
    try {
      await trips.create(tripFixture());
      const comment = await service.addComment('usr_A', 'trip_T', '晚上改成粤菜');

      assert.strictEqual(comment.rawText, '晚上改成粤菜', '评论必须保存成功');
      const stored = await comments.listByTrip('trip_T');
      assert.ok(stored[0].evaluation, '评估记录必须保存');
      assert.strictEqual(stored[0].evaluation!.status, 'evaluated');

      const trip = await trips.findById('trip_T');
      assert.deepStrictEqual(trip!.currentPlan, planFixture(1), 'currentPlan 必须保持旧版本');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  await record('stage3 degradation: TRIP_UPDATE 抛错不得冒泡导致评论创建失败', async () => {
    const evaluationAI = stubEvaluationAI(
      evaluationEnvelope({ relevant: true, usable: true, updateRequired: true }),
    );
    const updateAI = stubUpdateAI({
      error: new TripUpdateAIError('AI_REQUEST_FAILED', '网关超时'),
    });
    const { directory, trips, service } = setup({ evaluationAI, updateAI });
    try {
      await trips.create(tripFixture());
      const comment = await service.addComment('usr_A', 'trip_T', '晚上改成粤菜');
      assert.strictEqual(comment.rawText, '晚上改成粤菜');
      const trip = await trips.findById('trip_T');
      assert.strictEqual(trip!.currentPlan!.version, 1, '计划必须保持旧版本');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  // ---------- 并发：版本 CAS ----------

  await record('stage3 concurrency: 并发更新不丢失，版本严格递增至 v3（受控重读重生成）', async () => {
    const evaluationAI = stubEvaluationAI(
      evaluationEnvelope({ relevant: true, usable: true, updateRequired: true }),
    );
    const updateAI = stubUpdateAI({
      envelopeFor: (input) => updateEnvelopeFor(input.currentPlan),
      // 制造两次更新同时在途的竞态窗口
      beforeResolve: () => new Promise<void>((resolve) => setTimeout(resolve, 10)),
    });
    const { directory, trips, service } = setup({ evaluationAI, updateAI });
    try {
      await trips.create(tripFixture());

      await Promise.all([
        service.addComment('usr_A', 'trip_T', '晚餐改粤菜'),
        service.addComment('usr_B', 'trip_T', '羽毛球改到四点'),
      ]);

      const trip = await trips.findById('trip_T');
      assert.strictEqual(
        trip!.currentPlan!.version,
        3,
        '两次更新都必须生效：v1 → v2 → v3，不存在 lost update',
      );
      // 落败的一方必须基于新版本重新生成，而不是用过期结果覆盖
      const baseVersions = updateAI.captured.map((input) => input.baseVersion).sort();
      assert.deepStrictEqual(
        baseVersions,
        [1, 1, 2],
        '冲突方必须重新读取到 v2 后再生成一次（首次两个 base=1，重试 base=2）',
      );
      assert.strictEqual(trip!.latestAIUI!.planVersion, 3, 'UI 提示必须对应最终版本');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  await record('stage3 concurrency: 过期结果绝不覆盖被抢先写入的新版本', async () => {
    const evaluationAI = stubEvaluationAI(
      evaluationEnvelope({ relevant: true, usable: true, updateRequired: true }),
    );
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cotrip-stage3-cas-'));
    try {
      fs.writeFileSync(
        path.join(directory, 'users.json'),
        JSON.stringify({ users: [userA, userB] }),
        'utf8',
      );
      const trips = new JsonTripRepository(path.join(directory, 'trips.json'));
      const comments = new JsonCommentRepository(path.join(directory, 'comments.json'));
      const users = new JsonUserRepository(path.join(directory, 'users.json'));

      // 别处抢先写入的 v2（例如另一进程/另一路径）
      const winnerPlan: TripPlan = {
        ...planFixture(2),
        summary: '别处抢先写入的 v2',
      };

      let externalWriteDone = false;
      const updateAI = stubUpdateAI({
        envelopeFor: (input) => updateEnvelopeFor(input.currentPlan),
        beforeResolve: async () => {
          if (externalWriteDone) return;
          externalWriteDone = true;
          const trip = await trips.findById('trip_T');
          await trips.update({ ...trip!, currentPlan: winnerPlan });
        },
      });

      const planGeneration = new TripPlanGenerationService(
        trips,
        evaluationAI,
        new UnavailableInitialGenerationAIService(),
        updateAI,
      );
      const service = new CommentService(
        comments,
        trips,
        users,
        new UnavailableAICommentService(),
        undefined,
        planGeneration,
      );

      await trips.create(tripFixture());
      await service.addComment('usr_A', 'trip_T', '晚上改成粤菜');

      const trip = await trips.findById('trip_T');
      assert.strictEqual(
        updateAI.captured.length,
        2,
        '版本冲突后必须重新读取并重新生成一次（且仅一次）',
      );
      assert.strictEqual(updateAI.captured[0].baseVersion, 1);
      assert.strictEqual(updateAI.captured[1].baseVersion, 2, '重试必须基于被抢先写入的 v2');
      assert.strictEqual(trip!.currentPlan!.version, 3, '重试结果基于 v2 产出 v3');
      assert.notStrictEqual(
        trip!.currentPlan!.summary,
        '基于 v1 的更新',
        '过期的 v1 结果绝不能覆盖 v2',
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  await record('stage3 concurrency: 连续冲突时放弃过期结果，不无限重试、不覆盖', async () => {
    const evaluationAI = stubEvaluationAI(
      evaluationEnvelope({ relevant: true, usable: true, updateRequired: true }),
    );
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cotrip-stage3-cas2-'));
    try {
      fs.writeFileSync(
        path.join(directory, 'users.json'),
        JSON.stringify({ users: [userA, userB] }),
        'utf8',
      );
      const trips = new JsonTripRepository(path.join(directory, 'trips.json'));
      const comments = new JsonCommentRepository(path.join(directory, 'comments.json'));
      const users = new JsonUserRepository(path.join(directory, 'users.json'));

      // 每次 AI 返回前都有别处抢先写入 → 永远冲突
      let externalVersion = 1;
      const updateAI = stubUpdateAI({
        envelopeFor: (input) => updateEnvelopeFor(input.currentPlan),
        beforeResolve: async () => {
          externalVersion += 1;
          const trip = await trips.findById('trip_T');
          await trips.update({
            ...trip!,
            currentPlan: { ...planFixture(externalVersion), summary: '别处写入' },
          });
        },
      });

      const planGeneration = new TripPlanGenerationService(
        trips,
        evaluationAI,
        new UnavailableInitialGenerationAIService(),
        updateAI,
      );
      const service = new CommentService(
        comments,
        trips,
        users,
        new UnavailableAICommentService(),
        undefined,
        planGeneration,
      );

      await trips.create(tripFixture());
      await service.addComment('usr_A', 'trip_T', '晚上改成粤菜');

      assert.strictEqual(
        updateAI.captured.length,
        2,
        '尝试次数必须有上界（首次 + 一次受控重试），绝不无限重试',
      );
      const trip = await trips.findById('trip_T');
      assert.strictEqual(trip!.currentPlan!.summary, '别处写入', '过期结果绝不覆盖他人写入');
      assert.strictEqual(trip!.currentPlan!.version, externalVersion);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
}
