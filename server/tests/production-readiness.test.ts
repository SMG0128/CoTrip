// server/tests/production-readiness.test.ts
// Trip AI Coordinator V1 — Production Readiness Review 回归测试。
// 覆盖 REVIEW 17 的 15 项：supersession 保守语义 / 幂等 / source reconciliation /
// legacy backfill / partial-write 恢复 / deterministic state 不受 AI 影响 /
// AI 不能解决冲突 / conflict identity 稳定 / 时区 / 预算单位 / 授权 / 客户端注入 /
// legacy 生产启动。全部 AI 走注入 mock（绝不调用真实 hy3）。

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { JsonTripRepository } from '../src/repositories/json-trip-repository';
import { JsonCommentRepository } from '../src/repositories/json-comment-repository';
import { JsonUserRepository } from '../src/repositories/json-user-repository';
import { JsonConstraintRepository } from '../src/repositories/json-constraint-repository';
import { CommentService } from '../src/services/comment-service';
import { ConstraintLedgerService, normalizeConstraintValue } from '../src/services/constraint-ledger-service';
import { TripConstraintEvaluator } from '../src/services/trip-constraint-evaluator';
import { TripCoordinationService } from '../src/services/trip-coordination-service';
import {
  TripCoordinationAIService,
  TripCoordinationAIError,
} from '../src/services/trip-coordination-ai-service';
import { validateCoordinationProposal } from '../src/services/trip-coordination-ai-validation';
import { Trip } from '../src/types/trip';
import { User } from '../src/types/user';
import { Comment } from '../src/types/comment';
import {
  AICommentAnalysis,
  ConstraintDraft,
} from '../src/types/ai-comment';
import {
  AICommentService,
  AICommentServiceError,
} from '../src/services/ai-comment-service';
import { TripConstraint } from '../src/types/trip-constraint';
import { TripCoordinationProposal } from '../src/types/trip-coordination-proposal';
import { TripCoordinationAIInput } from '../src/types/trip-coordination-ai-input';
import { record } from './run-tests';

function fixture(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip_T',
    title: '生产就绪审查行程',
    status: 'ACTIVE',
    creatorId: 'usr_A',
    participantIds: ['usr_A'],
    createdAt: '2026-08-20T10:00:00.000Z',
    roomCode: 'ABCDEFG',
    initialBrief: 'fixture trip',
    commentIds: [],
    constraintIds: [],
    ...overrides,
  };
}

const userA: User = {
  id: 'usr_A', wechatOpenId: 'oa', nickname: 'A', avatarUrl: '', profileCompleted: true, createdAt: 1, updatedAt: 1,
};
const userB: User = {
  id: 'usr_B', wechatOpenId: 'ob', nickname: 'B', avatarUrl: '', profileCompleted: true, createdAt: 2, updatedAt: 2,
};

class StubAICommentService implements AICommentService {
  readonly source = 'provider' as const;
  constructor(private readonly responses: Array<AICommentAnalysis | Error>) {}
  analyzeComment(): Promise<AICommentAnalysis> {
    const next = this.responses.shift();
    if (!next) return Promise.reject(new AICommentServiceError('AI_REQUEST_FAILED', 'queue exhausted'));
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  }
}

class StubCoordinationAIService implements TripCoordinationAIService {
  readonly source = 'provider' as const;
  constructor(private readonly onCall?: (input: unknown) => TripCoordinationProposal | Error) {}
  analyzeCoordination(input: unknown): Promise<TripCoordinationProposal> {
    if (!this.onCall) return Promise.reject(new TripCoordinationAIError('AI_REQUEST_FAILED', 'stub not configured'));
    const result = this.onCall(input);
    if (result instanceof Error) return Promise.reject(result);
    return Promise.resolve(result);
  }
}

class UnavailableCommentAI implements AICommentService {
  readonly source = 'none' as const;
  analyzeComment(): Promise<AICommentAnalysis> {
    return Promise.reject(new AICommentServiceError('AI_NOT_CONFIGURED', 'not configured'));
  }
}
class UnavailableCoordinationAI implements TripCoordinationAIService {
  readonly source = 'none' as const;
  analyzeCoordination(): Promise<TripCoordinationProposal> {
    return Promise.reject(new TripCoordinationAIError('AI_NOT_CONFIGURED', 'not configured'));
  }
}

interface Harness {
  directory: string;
  constraints: JsonConstraintRepository;
  comments: JsonCommentRepository;
  ledger: ConstraintLedgerService;
  evaluator: TripConstraintEvaluator;
  coordination: TripCoordinationService;
  commentService: CommentService;
  trips: JsonTripRepository;
  setCoordinatorAI(ai: TripCoordinationAIService): void;
}

function setup(commentAI: AICommentService = new UnavailableCommentAI()): Harness {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cotrip-prodready-'));
  fs.writeFileSync(path.join(directory, 'users.json'), JSON.stringify({ users: [userA, userB] }), 'utf8');
  const trips = new JsonTripRepository(path.join(directory, 'trips.json'));
  const comments = new JsonCommentRepository(path.join(directory, 'comments.json'));
  const users = new JsonUserRepository(path.join(directory, 'users.json'));
  const constraints = new JsonConstraintRepository(path.join(directory, 'constraints.json'));
  const ledger = new ConstraintLedgerService(constraints);
  const commentService = new CommentService(comments, trips, users, commentAI, ledger);
  const evaluator = new TripConstraintEvaluator();
  let coordinationAI: TripCoordinationAIService = new UnavailableCoordinationAI();
  const coordination = new TripCoordinationService(trips, constraints, evaluator, coordinationAI, comments, ledger);
  return {
    directory, constraints, comments, ledger, evaluator, coordination, commentService, trips,
    setCoordinatorAI(ai: TripCoordinationAIService) {
      coordinationAI = ai;
      (coordination as unknown as { ai: TripCoordinationAIService }).ai = ai;
    },
  };
}

const okAnalysis = (constraints: ConstraintDraft[]): AICommentAnalysis => ({
  intent: 'constraint', constraints, confidence: 0.95, requiresConfirmation: false,
});

const availabilityAfter = (iso: string): ConstraintDraft => ({
  type: 'AVAILABILITY', scope: 'TRIP', priority: 'HARD', value: { availableAfter: iso },
});
const availabilityUntil = (iso: string): ConstraintDraft => ({
  type: 'AVAILABILITY', scope: 'TRIP', priority: 'HARD', value: { availableUntil: iso },
});

function constraint(overrides: Partial<TripConstraint>): TripConstraint {
  return {
    id: `c_${Math.random().toString(36).slice(2, 8)}`,
    tripId: 'trip_T',
    sourceCommentId: 'comment_x',
    userId: 'usr_A',
    type: 'AVAILABILITY',
    scope: 'TRIP',
    priority: 'HARD',
    value: {},
    status: 'ACTIVE',
    requiresConfirmation: false,
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:00.000Z',
    ...overrides,
  };
}

export async function runProductionReadinessTests(): Promise<void> {
  // (1) HARD replacement not auto-confirmed
  await record('prod-ready: 新 HARD 候选出现后旧 HARD 不得被自动 SUPERSEDED', async () => {
    const h = setup();
    try {
      await h.trips.create(fixture());
      await h.ledger.persistFromAnalysis(
        { tripId: 'trip_T', commentId: 'comment_1', userId: 'usr_A', createdAt: '2026-08-30T00:00:00.000Z' },
        okAnalysis([availabilityUntil('2026-08-30T17:00:00+08:00')]),
      );
      await h.ledger.persistFromAnalysis(
        { tripId: 'trip_T', commentId: 'comment_2', userId: 'usr_A', createdAt: '2026-08-30T01:00:00.000Z' },
        okAnalysis([availabilityUntil('2026-08-30T18:00:00+08:00')]),
      );
      const list = await h.constraints.listByTrip('trip_T');
      const oldC = list.find((c) => c.sourceCommentId === 'comment_1')!;
      const newC = list.find((c) => c.sourceCommentId === 'comment_2')!;
      assert.strictEqual(oldC.status, 'ACTIVE', '确认前旧 HARD 必须保持 ACTIVE');
      assert.strictEqual(newC.status, 'ACTIVE');
      assert.strictEqual(newC.supersedesConstraintId, oldC.id);
      assert.strictEqual(newC.requiresConfirmation, true);
    } finally {
      fs.rmSync(h.directory, { recursive: true, force: true });
    }
  });

  // (2) old HARD remains authoritative before confirmation（保守交集）
  await record('prod-ready: 确认前 evaluator 保守 —— 新 HARD 不自动放宽旧 HARD', async () => {
    const h = setup();
    try {
      await h.trips.create(fixture());
      await h.ledger.persistFromAnalysis(
        { tripId: 'trip_T', commentId: 'comment_1', userId: 'usr_A', createdAt: '2026-08-30T00:00:00.000Z' },
        okAnalysis([availabilityUntil('2026-08-30T17:00:00+08:00')]),
      );
      await h.ledger.persistFromAnalysis(
        { tripId: 'trip_T', commentId: 'comment_2', userId: 'usr_A', createdAt: '2026-08-30T01:00:00.000Z' },
        okAnalysis([availabilityUntil('2026-08-30T18:00:00+08:00')]),
      );
      const list = await h.constraints.listByTrip('trip_T');
      const state = h.evaluator.evaluate({ tripId: 'trip_T', constraints: list, participantIds: ['usr_A'] });
      assert.deepStrictEqual(state.commonAvailability, { after: undefined, until: '17:00' }, '必须保守取旧 HARD 的 17:00');
      assert.strictEqual(state.requiresConfirmation, true);
      assert.strictEqual(state.supersessionCandidates.length, 1);
    } finally {
      fs.rmSync(h.directory, { recursive: true, force: true });
    }
  });

  // (3) same comment processed twice → no duplicates
  await record('prod-ready: 同一评论重复处理不产生重复约束（N 次仍 2 条）', async () => {
    const h = setup();
    try {
      await h.trips.create(fixture());
      const input = { tripId: 'trip_T', commentId: 'comment_1', userId: 'usr_A', createdAt: '2026-08-30T00:00:00.000Z' };
      const analysis = okAnalysis([
        availabilityAfter('2026-08-30T14:00:00+08:00'),
        availabilityUntil('2026-08-30T17:00:00+08:00'),
      ]);
      await h.ledger.persistFromAnalysis(input, analysis);
      assert.strictEqual((await h.constraints.listByTrip('trip_T')).length, 2, '第一次处理应产生 2 条');
      await h.ledger.persistFromAnalysis(input, analysis);
      assert.strictEqual((await h.constraints.listByTrip('trip_T')).length, 2, '第二次处理不得新增');
      for (let i = 0; i < 3; i++) {
        await h.ledger.persistFromAnalysis(input, analysis);
      }
      assert.strictEqual((await h.constraints.listByTrip('trip_T')).length, 2, '重复 N 次仍为 2 条');
    } finally {
      fs.rmSync(h.directory, { recursive: true, force: true });
    }
  });

  // (4) source analysis reconciliation（1 → 2 约束，数量不膨胀）
  await record('prod-ready: 同一评论重新分析且内容变化 → 以最新 analysis 为准，无幽灵约束', async () => {
    const h = setup();
    try {
      await h.trips.create(fixture());
      const input = { tripId: 'trip_T', commentId: 'comment_1', userId: 'usr_A', createdAt: '2026-08-30T00:00:00.000Z' };
      await h.ledger.persistFromAnalysis(input, okAnalysis([availabilityAfter('2026-08-30T14:00:00+08:00')]));
      assert.strictEqual((await h.constraints.listByTrip('trip_T')).length, 1, '第一次 1 条');
      await h.ledger.persistFromAnalysis(input, okAnalysis([
        availabilityAfter('2026-08-30T14:00:00+08:00'),
        availabilityUntil('2026-08-30T17:00:00+08:00'),
      ]));
      const list = await h.constraints.listByTrip('trip_T');
      assert.strictEqual(list.length, 3, '历史保留 + 新集合 = 3 条（1 SUPERSEDED + 2 ACTIVE）');
      assert.strictEqual(list.filter((c) => c.status === 'ACTIVE').length, 2, 'ACTIVE 必须等于最新 analysis 数量');
      assert.strictEqual(list.filter((c) => c.status === 'SUPERSEDED').length, 1, '旧集合标记 SUPERSEDED 保留历史');
      // 与最新一致 → 幂等 no-op
      await h.ledger.persistFromAnalysis(input, okAnalysis([
        availabilityAfter('2026-08-30T14:00:00+08:00'),
        availabilityUntil('2026-08-30T17:00:00+08:00'),
      ]));
      const list2 = await h.constraints.listByTrip('trip_T');
      assert.strictEqual(list2.filter((c) => c.status === 'ACTIVE').length, 2, '重复处理最新 analysis 不得膨胀 ACTIVE');
    } finally {
      fs.rmSync(h.directory, { recursive: true, force: true });
    }
  });

  // (5) legacy aiAnalysis backfill
  await record('prod-ready: 旧生产评论（aiAnalysis 已持久化）自动 backfill 进 Ledger', async () => {
    const h = setup();
    try {
      await h.trips.create(fixture());
      const legacy: Comment = {
        id: 'comment_legacy',
        tripId: 'trip_T',
        userId: 'usr_A',
        rawText: '我 14:00 后有空',
        createdAt: '2026-08-01T00:00:00.000Z',
        aiStatus: 'accepted',
        aiSource: 'provider',
        aiAnalysis: okAnalysis([availabilityAfter('2026-08-30T14:00:00+08:00')]),
      };
      await h.comments.create(legacy);
      // constraints.json 尚不存在（旧生产数据）：读取不应 crash
      const result = await h.coordination.getCoordination('usr_A', 'trip_T');
      assert.strictEqual(result.coordination.activeConstraintCount, 1, 'backfill 后协调状态必须包含旧约束');
      const list = await h.constraints.listByTrip('trip_T');
      assert.strictEqual(list.length, 1);
      assert.strictEqual(list[0].sourceCommentId, 'comment_legacy', '约束必须可追溯到旧评论');
      assert.deepStrictEqual(list[0].value, { after: '14:00' });
    } finally {
      fs.rmSync(h.directory, { recursive: true, force: true });
    }
  });

  // (6) backfill idempotent
  await record('prod-ready: backfill 重复运行不产生重复约束', async () => {
    const h = setup();
    try {
      await h.trips.create(fixture());
      const legacy: Comment = {
        id: 'comment_legacy',
        tripId: 'trip_T',
        userId: 'usr_A',
        rawText: '我 14:00 后有空',
        createdAt: '2026-08-01T00:00:00.000Z',
        aiStatus: 'accepted',
        aiSource: 'provider',
        aiAnalysis: okAnalysis([availabilityAfter('2026-08-30T14:00:00+08:00')]),
      };
      await h.comments.create(legacy);
      await h.coordination.getCoordination('usr_A', 'trip_T');
      await h.coordination.getCoordination('usr_A', 'trip_T');
      await h.coordination.getCoordination('usr_A', 'trip_T');
      assert.strictEqual((await h.constraints.listByTrip('trip_T')).length, 1, 'backfill 幂等：多次读取仍 1 条');
    } finally {
      fs.rmSync(h.directory, { recursive: true, force: true });
    }
  });

  // (7) materialization failure safe（ledger 失败 → 评论权威 analysis 保留，backfill 可恢复）
  await record('prod-ready: Ledger 写入失败时评论保留 accepted+aiAnalysis，可被 backfill 恢复', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cotrip-prodready-fail-'));
    fs.writeFileSync(path.join(directory, 'users.json'), JSON.stringify({ users: [userA, userB] }), 'utf8');
    try {
      const trips = new JsonTripRepository(path.join(directory, 'trips.json'));
      const comments = new JsonCommentRepository(path.join(directory, 'comments.json'));
      const users = new JsonUserRepository(path.join(directory, 'users.json'));
      await trips.create(fixture());
      const failingLedger = {
        persistFromAnalysis: async () => { throw new Error('simulated disk failure'); },
      } as unknown as ConstraintLedgerService;
      const commentService = new CommentService(comments, trips, users, new StubAICommentService([
        okAnalysis([availabilityAfter('2026-08-30T14:00:00+08:00')]),
      ]), failingLedger);
      const created = await commentService.addComment('usr_A', 'trip_T', '我 14:00 后有空');
      assert.strictEqual(created.aiStatus, 'accepted', 'AI 分析成功时评论必须 accepted');
      assert.ok(created.aiAnalysis, 'aiAnalysis 必须已持久化（权威源可重放）');
      assert.deepStrictEqual((await comments.listByTrip('trip_T'))[0].aiAnalysis?.constraints.length, 1, 'analysis 不丢失');
      // 真实 ledger 从已持久化 analysis 恢复
      const realConstraints = new JsonConstraintRepository(path.join(directory, 'constraints.json'));
      const realLedger = new ConstraintLedgerService(realConstraints);
      const restored = await realLedger.backfillFromComments([created]);
      assert.strictEqual(restored, 1, 'backfill 恢复 1 条约束');
      assert.strictEqual((await realConstraints.listByTrip('trip_T')).length, 1);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  // (8) deterministic state immune to AI claims
  await record('prod-ready: AI 撒谎的时间范围无法覆盖 Server deterministic state', async () => {
    const h = setup();
    try {
      await h.trips.create(fixture({ participantIds: ['usr_A', 'usr_B'] }));
      await h.constraints.create(constraint({ id: 'c1', userId: 'usr_A', sourceCommentId: 'c1s', value: { after: '16:00' } }));
      await h.constraints.create(constraint({ id: 'c2', userId: 'usr_B', sourceCommentId: 'c2s', value: { until: '17:00' } }));
      const ai = new StubCoordinationAIService(() => ({
        summary: '我撒谎：共同时间其实是 10:00-22:00',
        status: 'READY',
        suggestions: [],
      }));
      h.setCoordinatorAI(ai);
      const result = await h.coordination.analyze('usr_A', 'trip_T');
      assert.deepStrictEqual(result.coordination.commonAvailability, { after: '16:00', until: '17:00' }, 'state 由 evaluator 决定');
      assert.ok(result.coordination.commonAvailability && result.coordination.commonAvailability.after === '16:00');
    } finally {
      fs.rmSync(h.directory, { recursive: true, force: true });
    }
  });

  // (9) AI cannot resolve conflict
  await record('prod-ready: AI 声明 satisfied/resolved 被拒绝，TripConflict 状态保持 OPEN', async () => {
    const h = setup();
    try {
      await h.trips.create(fixture({ participantIds: ['usr_A', 'usr_B'] }));
      await h.constraints.create(constraint({ id: 'c1', userId: 'usr_A', sourceCommentId: 'c1s', value: { after: '18:00' } }));
      await h.constraints.create(constraint({ id: 'c2', userId: 'usr_B', sourceCommentId: 'c2s', value: { until: '17:00' } }));
      const stateBefore = h.evaluator.evaluate({ tripId: 'trip_T', constraints: await h.constraints.listByTrip('trip_T'), participantIds: ['usr_A', 'usr_B'] });
      assert.strictEqual(stateBefore.hardConflicts.length, 1, '前置：存在硬冲突');
      const conflictId = stateBefore.hardConflicts[0].id;

      const badProposal = { summary: 'ok', status: 'READY', suggestions: [], satisfied: true } as unknown as TripCoordinationProposal;
      const validation = validateCoordinationProposal(badProposal);
      assert.strictEqual(validation.ok, false, 'schema 必须拒绝 satisfied 字段');
      assert.strictEqual((validation as { failureReasonCode: string }).failureReasonCode, 'AI_FORBIDDEN_SATISFACTION_FIELD');

      const ai = new StubCoordinationAIService(() => {
        const p = { ...badProposal } as TripCoordinationProposal;
        p.suggestions = [{ kind: 'OTHER' as const, affectedConstraintIds: [], message: '该冲突已经解决', requiresConfirmation: false, confidence: 0.5 }];
        return p;
      });
      h.setCoordinatorAI(ai);
      const result = await h.coordination.analyze('usr_A', 'trip_T');
      assert.strictEqual(result.coordinationUnavailable, true, '非法 proposal 必须置 AI 不可用');
      assert.strictEqual(result.proposal, undefined, '不得返回非法 proposal');
      assert.strictEqual(result.coordination.hardConflicts[0].id, conflictId, 'conflict 身份不变');
      assert.strictEqual(result.coordination.hardConflicts[0].status, 'OPEN', 'AI 不能把冲突改成 RESOLVED');
    } finally {
      fs.rmSync(h.directory, { recursive: true, force: true });
    }
  });

  // (10) stable conflict identity
  await record('prod-ready: 相同 authoritative input → 相同 conflict identity（顺序无关）', async () => {
    const h = setup();
    try {
      const constraints = [
        constraint({ id: 'c1', userId: 'usr_A', value: { after: '18:00' } }),
        constraint({ id: 'c2', userId: 'usr_B', value: { until: '17:00' } }),
      ];
      const eval1 = h.evaluator.evaluate({ tripId: 'trip_T', constraints, participantIds: ['usr_A', 'usr_B'] });
      const eval2 = h.evaluator.evaluate({ tripId: 'trip_T', constraints: [...constraints].reverse(), participantIds: ['usr_A', 'usr_B'] });
      assert.strictEqual(eval1.hardConflicts.length, 1);
      assert.strictEqual(eval1.hardConflicts[0].id, eval2.hardConflicts[0].id, '乱序输入必须得到相同 conflict id');
      assert.deepStrictEqual(eval1.hardConflicts[0].constraintIds, ['c1', 'c2'], 'constraintIds 必须排序稳定');
      const other = h.evaluator.evaluate({
        tripId: 'trip_T',
        constraints: [constraint({ id: 'c1', userId: 'usr_A', value: { after: '18:00' } }), constraint({ id: 'c3', userId: 'usr_B', value: { until: '16:00' } })],
        participantIds: ['usr_A', 'usr_B'],
      });
      assert.strictEqual(other.hardConflicts[0].constraintIds.join(','), 'c1,c3');
      assert.notStrictEqual(other.hardConflicts[0].id, eval1.hardConflicts[0].id, '不同约束集必须产生不同 id');
    } finally {
      fs.rmSync(h.directory, { recursive: true, force: true });
    }
  });

  // (11) timezone comparison（不同 offset 同一 instant → 同墙钟；跨午夜窗口）
  await record('prod-ready: 不同时区 offset 的同一 instant 换算为同一墙钟时间', async () => {
    const h = setup();
    try {
      await h.trips.create(fixture({ participantIds: ['usr_A', 'usr_B'] }));
      // 16:00+08:00 与 08:00Z 是同一 instant → 都换算为 16:00
      await h.ledger.persistFromAnalysis(
        { tripId: 'trip_T', commentId: 'comment_1', userId: 'usr_A', createdAt: '2026-08-30T00:00:00.000Z' },
        okAnalysis([availabilityAfter('2026-08-30T16:00:00+08:00')]),
      );
      await h.ledger.persistFromAnalysis(
        { tripId: 'trip_T', commentId: 'comment_2', userId: 'usr_B', createdAt: '2026-08-30T00:00:00.000Z' },
        okAnalysis([availabilityUntil('2026-08-30T08:00:00Z')]),
      );
      const list = await h.constraints.listByTrip('trip_T');
      const state = h.evaluator.evaluate({ tripId: 'trip_T', constraints: list, participantIds: ['usr_A', 'usr_B'] });
      assert.strictEqual(state.hardConflicts.length, 0, '同一 instant 不得误判为冲突');
      assert.deepStrictEqual(state.commonAvailability, { after: '16:00', until: '16:00' });
    } finally {
      fs.rmSync(h.directory, { recursive: true, force: true });
    }
  });

  await record('prod-ready: 跨午夜可用窗口（23:00-02:00）正确求交集', async () => {
    const h = setup();
    try {
      await h.trips.create(fixture({ participantIds: ['usr_A', 'usr_B'] }));
      await h.ledger.persistFromAnalysis(
        { tripId: 'trip_T', commentId: 'comment_1', userId: 'usr_A', createdAt: '2026-08-30T00:00:00.000Z' },
        okAnalysis([
          availabilityAfter('2026-08-30T23:00:00+08:00'),
          availabilityUntil('2026-08-31T02:00:00+08:00'),
        ]),
      );
      await h.ledger.persistFromAnalysis(
        { tripId: 'trip_T', commentId: 'comment_2', userId: 'usr_B', createdAt: '2026-08-30T00:00:00.000Z' },
        okAnalysis([
          availabilityAfter('2026-08-30T23:30:00+08:00'),
          availabilityUntil('2026-08-31T01:00:00+08:00'),
        ]),
      );
      const list = await h.constraints.listByTrip('trip_T');
      const state = h.evaluator.evaluate({ tripId: 'trip_T', constraints: list, participantIds: ['usr_A', 'usr_B'] });
      assert.strictEqual(state.hardConflicts.length, 0, '跨午夜窗口应存在公共时段');
      assert.deepStrictEqual(state.commonAvailability, { after: '23:30', until: '01:00' });
    } finally {
      fs.rmSync(h.directory, { recursive: true, force: true });
    }
  });

  // (12) incompatible budget units not merged
  await record('prod-ready: 不兼容预算单位不合并（BUDGET_UNIT_MISMATCH，无 commonBudget）', async () => {
    const h = setup();
    try {
      const constraints = [
        constraint({ id: 'b1', userId: 'usr_A', type: 'BUDGET', value: { min: 100, currency: 'CNY', unit: 'TOTAL' } }),
        constraint({ id: 'b2', userId: 'usr_B', type: 'BUDGET', value: { max: 80, currency: 'CNY', unit: 'PER_PERSON' } }),
      ];
      const state = h.evaluator.evaluate({ tripId: 'trip_T', constraints, participantIds: ['usr_A', 'usr_B'] });
      assert.strictEqual(state.commonBudget, undefined, '单位不一致时不得假算共同预算');
      assert.strictEqual(state.hardConflicts.length, 1);
      assert.strictEqual(state.hardConflicts[0].reasonCode, 'BUDGET_UNIT_MISMATCH');
    } finally {
      fs.rmSync(h.directory, { recursive: true, force: true });
    }
  });

  await record('prod-ready: 兼容单位（同 TOTAL）正常求交集', async () => {
    const h = setup();
    try {
      const constraints = [
        constraint({ id: 'b1', userId: 'usr_A', type: 'BUDGET', value: { max: 100, unit: 'TOTAL' } }),
        constraint({ id: 'b2', userId: 'usr_B', type: 'BUDGET', value: { max: 80, unit: 'TOTAL' } }),
      ];
      const state = h.evaluator.evaluate({ tripId: 'trip_T', constraints, participantIds: ['usr_A', 'usr_B'] });
      assert.deepStrictEqual(state.commonBudget, { max: 80 }, '兼容单位可合并');
      assert.strictEqual(state.hardConflicts.length, 0);
    } finally {
      fs.rmSync(h.directory, { recursive: true, force: true });
    }
  });

  // (13) non-member authorization（GET constraints / GET coordination / POST analyze）
  await record('prod-ready: 非成员访问 constraints/coordination/analyze 全部被拒', async () => {
    const h = setup();
    try {
      await h.trips.create(fixture({ participantIds: ['usr_A'] }));
      await h.constraints.create(constraint({ id: 'c1', userId: 'usr_A', value: { after: '14:00' } }));
      const expectForbidden = async (fn: () => Promise<unknown>) => {
        try {
          await fn();
          assert.fail('应当抛出 TRIP_FORBIDDEN');
        } catch (error) {
          assert.strictEqual((error as { code: string }).code, 'TRIP_FORBIDDEN');
        }
      };
      await expectForbidden(() => h.coordination.listConstraints('usr_B', 'trip_T'));
      await expectForbidden(() => h.coordination.getCoordination('usr_B', 'trip_T'));
      await expectForbidden(() => h.coordination.analyze('usr_B', 'trip_T'));
      // 成员可读
      const ok = await h.coordination.listConstraints('usr_A', 'trip_T');
      assert.strictEqual(ok.length, 1);
    } finally {
      fs.rmSync(h.directory, { recursive: true, force: true });
    }
  });

  // (14) client constraints ignored（Server 自行加载 Ledger）
  await record('prod-ready: coordination endpoint 不信任客户端约束，只读 Server Ledger', async () => {
    const h = setup();
    try {
      await h.trips.create(fixture({ participantIds: ['usr_A'] }));
      await h.constraints.create(constraint({ id: 'c1', userId: 'usr_A', sourceCommentId: 'comment_x', value: { after: '14:00' } }));
      let captured: unknown = null;
      const ai = new StubCoordinationAIService((input) => {
        captured = input;
        return { summary: 'ok', status: 'READY', suggestions: [] };
      });
      h.setCoordinatorAI(ai);
      // analyze 签名不含 constraints 参数（API 层面不接收客户端约束）
      const result = await h.coordination.analyze('usr_A', 'trip_T');
      const input = captured as TripCoordinationAIInput;
      assert.strictEqual(input.constraints.length, 1, 'AI 收到的约束必须来自 Server Ledger');
      assert.strictEqual(input.constraints[0].value.after, '14:00');
      assert.strictEqual(result.coordination.activeConstraintCount, 1);
      assert.strictEqual(result.coordination.hardConflicts.length, 0);
    } finally {
      fs.rmSync(h.directory, { recursive: true, force: true });
    }
  });

  // (15) production legacy startup（constraints.json 不存在 → 不 crash、lazy backfill、rawText 不变）
  await record('prod-ready: 旧生产数据启动新版 Server 不 crash 且自动补写 Ledger', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cotrip-prodready-startup-'));
    fs.writeFileSync(path.join(directory, 'users.json'), JSON.stringify({ users: [userA, userB] }), 'utf8');
    try {
      const trips = new JsonTripRepository(path.join(directory, 'trips.json'));
      const comments = new JsonCommentRepository(path.join(directory, 'comments.json'));
      const users = new JsonUserRepository(path.join(directory, 'users.json'));
      await trips.create(fixture({ participantIds: ['usr_A', 'usr_B'] }));
      // 旧生产数据：只存在 users/trips/comments，无 constraints.json
      const legacyComment1: Comment = {
        id: 'legacy_1', tripId: 'trip_T', userId: 'usr_A', rawText: '我 14:00 后有空',
        createdAt: '2026-07-01T00:00:00.000Z', aiStatus: 'accepted', aiSource: 'provider',
        aiAnalysis: okAnalysis([availabilityAfter('2026-08-30T14:00:00+08:00')]),
      };
      const legacyComment2: Comment = {
        id: 'legacy_2', tripId: 'trip_T', userId: 'usr_B', rawText: '我必须 17:00 前走',
        createdAt: '2026-07-02T00:00:00.000Z', aiStatus: 'accepted', aiSource: 'provider',
        aiAnalysis: okAnalysis([availabilityUntil('2026-08-30T17:00:00+08:00')]),
      };
      await comments.create(legacyComment1);
      await comments.create(legacyComment2);

      // 新版启动：constraints.json 尚不存在
      const constraints = new JsonConstraintRepository(path.join(directory, 'constraints.json'));
      const ledger = new ConstraintLedgerService(constraints);
      const evaluator = new TripConstraintEvaluator();
      const coordination = new TripCoordinationService(
        trips, constraints, evaluator, new UnavailableCoordinationAI(), comments, ledger,
      );

      const result = await coordination.getCoordination('usr_A', 'trip_T');
      assert.strictEqual(result.coordination.activeConstraintCount, 2, 'legacy aiAnalysis 必须被 backfill');
      assert.strictEqual(result.coordination.participantCount, 2);
      assert.strictEqual(result.coordination.hardConflicts.length, 0, '14:00 后 + 17:00 前无冲突');
      // 不修改 rawText / 不调用 AI（Unavailable AI 未被触发即证明）
      const stored = await comments.listByTrip('trip_T');
      assert.strictEqual(stored[0].rawText, '我 14:00 后有空', 'rawText 必须原样保留');
      assert.strictEqual(stored[1].rawText, '我必须 17:00 前走', 'rawText 必须原样保留');
      // 重复读取幂等
      await coordination.getCoordination('usr_A', 'trip_T');
      assert.strictEqual((await constraints.listByTrip('trip_T')).length, 2);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  // REVIEW 10 补充：extractTimeFromIso 时区换算单元断言
  await record('prod-ready: extractTimeFromIso 将不同 offset 的同一 instant 归一化为同一墙钟', async () => {
    assert.strictEqual(normalizeConstraintValue('AVAILABILITY', { availableAfter: '2026-08-30T16:00:00+08:00' })?.after, '16:00');
    assert.strictEqual(normalizeConstraintValue('AVAILABILITY', { availableAfter: '2026-08-30T08:00:00Z' })?.after, '16:00');
    assert.strictEqual(normalizeConstraintValue('AVAILABILITY', { availableAfter: '2026-08-30T09:00:00Z' })?.after, '17:00');
    assert.strictEqual(normalizeConstraintValue('BUDGET', { min: 100, currency: 'CNY', unit: 'PER_PERSON' })?.unit, 'PER_PERSON');
  });
}
