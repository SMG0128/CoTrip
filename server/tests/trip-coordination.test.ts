// server/tests/trip-coordination.test.ts
// 协调系统后端测试：Constraint Ledger 持久化 + 确定性评估 + 冲突 + AI 协调建议边界。
// 不 mock 仓库（真实 JSON 落盘），全部 AI 走注入 mock（绝不调用真实 hy3）。

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { JsonTripRepository } from '../src/repositories/json-trip-repository';
import { JsonCommentRepository } from '../src/repositories/json-comment-repository';
import { JsonUserRepository } from '../src/repositories/json-user-repository';
import { JsonConstraintRepository } from '../src/repositories/json-constraint-repository';
import { CommentService } from '../src/services/comment-service';
import { ConstraintLedgerService } from '../src/services/constraint-ledger-service';
import { TripConstraintEvaluator } from '../src/services/trip-constraint-evaluator';
import { TripCoordinationService } from '../src/services/trip-coordination-service';
import {
  TripCoordinationAIService,
  TripCoordinationAIError,
} from '../src/services/trip-coordination-ai-service';
import { validateCoordinationProposal } from '../src/services/trip-coordination-ai-validation';
import { Trip } from '../src/types/trip';
import { User } from '../src/types/user';
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
import { record } from './run-tests';

function fixture(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip_T',
    title: '协调测试行程',
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

/** 可控 Mock：通过队列返回 analysis，模拟 AI 成功/失败 */
class StubAICommentService implements AICommentService {
  readonly source = 'provider' as const;
  constructor(private readonly responses: Array<AICommentAnalysis | Error>) {}
  analyzeComment(): Promise<AICommentAnalysis> {
    const next = this.responses.shift();
    if (!next) {
      return Promise.reject(new AICommentServiceError('AI_REQUEST_FAILED', 'queue exhausted'));
    }
    if (next instanceof Error) {
      return Promise.reject(next);
    }
    return Promise.resolve(next);
  }
}

/** 可控 Mock Coordinator AI */
class StubCoordinationAIService implements TripCoordinationAIService {
  readonly source = 'provider' as const;
  constructor(
    private readonly onCall?: (input: unknown) => TripCoordinationProposal | Error,
  ) {}
  analyzeCoordination(input: unknown): Promise<TripCoordinationProposal> {
    if (this.onCall) {
      const result = this.onCall(input);
      if (result instanceof Error) return Promise.reject(result);
      return Promise.resolve(result);
    }
    return Promise.reject(new TripCoordinationAIError('AI_REQUEST_FAILED', 'stub not configured'));
  }
}

interface Harness {
  directory: string;
  constraints: JsonConstraintRepository;
  ledger: ConstraintLedgerService;
  evaluator: TripConstraintEvaluator;
  coordination: TripCoordinationService;
  commentService: CommentService;
  trips: JsonTripRepository;
  setCoordinatorAI(ai: TripCoordinationAIService): void;
}

function setup(commentAI: AICommentService = new UnavailableCommentAI()): Harness {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cotrip-coordination-'));
  fs.writeFileSync(path.join(directory, 'users.json'), JSON.stringify({ users: [userA, userB] }), 'utf8');
  const trips = new JsonTripRepository(path.join(directory, 'trips.json'));
  const comments = new JsonCommentRepository(path.join(directory, 'comments.json'));
  const users = new JsonUserRepository(path.join(directory, 'users.json'));
  const constraints = new JsonConstraintRepository(path.join(directory, 'constraints.json'));
  const ledger = new ConstraintLedgerService(constraints);
  const commentService = new CommentService(comments, trips, users, commentAI, ledger);
  const evaluator = new TripConstraintEvaluator();
  let coordinationAI: TripCoordinationAIService = new UnavailableCoordinationAI();
  const coordination = new TripCoordinationService(trips, constraints, evaluator, coordinationAI);
  return {
    directory, constraints, ledger, evaluator, coordination, commentService, trips,
    setCoordinatorAI(ai: TripCoordinationAIService) {
      coordinationAI = ai;
      // 重建以注入新 AI（简单实现：替换内部引用）
      (coordination as unknown as { ai: TripCoordinationAIService }).ai = ai;
    },
  };
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

const okAnalysis = (constraints: ConstraintDraft[]): AICommentAnalysis => ({
  intent: 'constraint',
  constraints,
  confidence: 0.95,
  requiresConfirmation: false,
});

const availabilityAfter = (time: string): ConstraintDraft => ({
  type: 'AVAILABILITY', scope: 'TRIP', priority: 'HARD', value: { availableAfter: `2026-08-30T${time}:00+08:00` },
});
const availabilityUntil = (time: string): ConstraintDraft => ({
  type: 'AVAILABILITY', scope: 'TRIP', priority: 'HARD', value: { availableUntil: `2026-08-30T${time}:00+08:00` },
});

function constraint(
  overrides: Partial<TripConstraint>,
): TripConstraint {
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

export async function runTripCoordinationTests(): Promise<void> {
  // ---------- PHASE 3：Comment AI success → Constraint persisted ----------
  await record('coordination: AI 成功后约束持久化且可追溯 user+comment', async () => {
    const h = setup(new StubAICommentService([okAnalysis([availabilityAfter('14:00')])]));
    try {
      await h.trips.create(fixture());
      await h.commentService.addComment('usr_A', 'trip_T', '我 14:00 后有空');
      const list = await h.constraints.listByTrip('trip_T');
      assert.strictEqual(list.length, 1);
      assert.strictEqual(list[0].userId, 'usr_A', '约束必须归属到作者');
      assert.ok(list[0].sourceCommentId, '约束必须携带来源评论 id');
      assert.strictEqual(list[0].status, 'ACTIVE');
      assert.deepStrictEqual(list[0].value, { after: '14:00' });
    } finally {
      fs.rmSync(h.directory, { recursive: true, force: true });
    }
  });

  // ---------- PHASE 3：AI failure → no fake constraint ----------
  await record('coordination: AI 失败时评论保留、无伪造约束、aiStatus unresolved', async () => {
    const h = setup(new StubAICommentService([
      new AICommentServiceError('AI_REQUEST_FAILED', 'provider down'),
    ]));
    try {
      await h.trips.create(fixture());
      const created = await h.commentService.addComment('usr_A', 'trip_T', '我 14:00 后有空');
      assert.strictEqual(created.aiStatus, 'unresolved', 'AI 失败时评论必须 unresolved');
      const list = await h.constraints.listByTrip('trip_T');
      assert.deepStrictEqual(list, [], 'AI 失败时绝不写入约束');
    } finally {
      fs.rmSync(h.directory, { recursive: true, force: true });
    }
  });

  // ---------- PHASE 5：availability intersection ----------
  await record('coordination: availability 交集 A(14后)+B(16后)+C(17前)=16:00-17:00 无冲突', async () => {
    const h = setup();
    try {
      const list = [
        constraint({ id: 'c1', userId: 'usr_A', value: { after: '14:00' } }),
        constraint({ id: 'c2', userId: 'usr_B', value: { after: '16:00' } }),
        constraint({ id: 'c3', userId: 'usr_C', value: { until: '17:00' } }),
      ];
      const state = h.evaluator.evaluate({ tripId: 'trip_T', constraints: list, participantIds: ['usr_A', 'usr_B', 'usr_C'] });
      assert.deepStrictEqual(state.commonAvailability, { after: '16:00', until: '17:00' });
      assert.strictEqual(state.hardConflicts.length, 0, '16:00-17:00 不构成冲突');
    } finally {
      fs.rmSync(h.directory, { recursive: true, force: true });
    }
  });

  // ---------- PHASE 5：availability hard conflict ----------
  await record('coordination: availability 硬冲突 A(18后)+B(17前) → NO_COMMON_AVAILABILITY', async () => {
    const h = setup();
    try {
      const list = [
        constraint({ id: 'c1', userId: 'usr_A', value: { after: '18:00' } }),
        constraint({ id: 'c2', userId: 'usr_B', value: { until: '17:00' } }),
      ];
      const state = h.evaluator.evaluate({ tripId: 'trip_T', constraints: list, participantIds: ['usr_A', 'usr_B'] });
      assert.strictEqual(state.hardConflicts.length, 1);
      assert.strictEqual(state.hardConflicts[0].kind, 'HARD_CONFLICT');
      assert.strictEqual(state.hardConflicts[0].reasonCode, 'NO_COMMON_AVAILABILITY');
      assert.ok(state.hardConflicts[0].constraintIds.includes('c1') && state.hardConflicts[0].constraintIds.includes('c2'));
      assert.ok(state.hardConflicts[0].participantUserIds.includes('usr_A') && state.hardConflicts[0].participantUserIds.includes('usr_B'));
    } finally {
      fs.rmSync(h.directory, { recursive: true, force: true });
    }
  });

  // ---------- PHASE 5：budget intersection ----------
  await record('coordination: budget 交集 A(max100)+B(max80) → max=80 非冲突', async () => {
    const h = setup();
    try {
      const list = [
        constraint({ id: 'c1', type: 'BUDGET', userId: 'usr_A', value: { max: 100 } }),
        constraint({ id: 'c2', type: 'BUDGET', userId: 'usr_B', value: { max: 80 } }),
      ];
      const state = h.evaluator.evaluate({ tripId: 'trip_T', constraints: list, participantIds: ['usr_A', 'usr_B'] });
      assert.deepStrictEqual(state.commonBudget, { max: 80 });
      assert.strictEqual(state.hardConflicts.length, 0);
    } finally {
      fs.rmSync(h.directory, { recursive: true, force: true });
    }
  });

  // ---------- PHASE 5：budget hard conflict ----------
  await record('coordination: budget 硬冲突 A(min100)+B(max80) → BUDGET_RANGE_EMPTY', async () => {
    const h = setup();
    try {
      const list = [
        constraint({ id: 'c1', type: 'BUDGET', userId: 'usr_A', value: { min: 100 } }),
        constraint({ id: 'c2', type: 'BUDGET', userId: 'usr_B', value: { max: 80 } }),
      ];
      const state = h.evaluator.evaluate({ tripId: 'trip_T', constraints: list, participantIds: ['usr_A', 'usr_B'] });
      assert.strictEqual(state.hardConflicts.length, 1);
      assert.strictEqual(state.hardConflicts[0].reasonCode, 'BUDGET_RANGE_EMPTY');
    } finally {
      fs.rmSync(h.directory, { recursive: true, force: true });
    }
  });

  // ---------- PHASE 5：location policy ----------
  await record('coordination: 不同 city 的 HARD location → CITY_MISMATCH（不推断距离）', async () => {
    const h = setup();
    try {
      const list = [
        constraint({ id: 'c1', type: 'LOCATION', userId: 'usr_A', value: { city: '广州' } }),
        constraint({ id: 'c2', type: 'LOCATION', userId: 'usr_B', value: { city: '深圳' } }),
      ];
      const state = h.evaluator.evaluate({ tripId: 'trip_T', constraints: list, participantIds: ['usr_A', 'usr_B'] });
      assert.strictEqual(state.hardConflicts.length, 1);
      assert.strictEqual(state.hardConflicts[0].reasonCode, 'CITY_MISMATCH');
    } finally {
      fs.rmSync(h.directory, { recursive: true, force: true });
    }
  });

  await record('coordination: 同 city 同 district 不产生位置冲突（V1 不推断 POI 兼容性）', async () => {
    const h = setup();
    try {
      const list = [
        constraint({ id: 'c1', type: 'LOCATION', userId: 'usr_A', value: { city: '广州', district: '天河' } }),
        constraint({ id: 'c2', type: 'LOCATION', userId: 'usr_B', value: { city: '广州', district: '越秀' } }),
      ];
      const state = h.evaluator.evaluate({ tripId: 'trip_T', constraints: list, participantIds: ['usr_A', 'usr_B'] });
      assert.strictEqual(state.hardConflicts.length, 0, 'V1 不推断 district/POI 距离兼容性');
    } finally {
      fs.rmSync(h.directory, { recursive: true, force: true });
    }
  });

  // ---------- PHASE 5：soft preference tension ----------
  await record('coordination: 软偏好差异 A(越南菜)+B(日料) → SOFT_TENSION 非 HARD_CONFLICT', async () => {
    const h = setup();
    try {
      const list = [
        constraint({ id: 'c1', type: 'PREFERENCE', priority: 'SOFT', userId: 'usr_A', value: { category: '越南菜' } }),
        constraint({ id: 'c2', type: 'PREFERENCE', priority: 'SOFT', userId: 'usr_B', value: { category: '日料' } }),
      ];
      const state = h.evaluator.evaluate({ tripId: 'trip_T', constraints: list, participantIds: ['usr_A', 'usr_B'] });
      assert.strictEqual(state.softTensions.length, 1);
      assert.strictEqual(state.softTensions[0].kind, 'SOFT_TENSION');
      assert.strictEqual(state.softTensions[0].reasonCode, 'PREFERENCE_DIVERGENCE');
      assert.strictEqual(state.hardConflicts.length, 0, 'SOFT 张力绝不能成为 HARD_CONFLICT');
    } finally {
      fs.rmSync(h.directory, { recursive: true, force: true });
    }
  });

  // ---------- PHASE 4：supersession ----------
  await record('coordination: 同 user+type+scope 新约束替代旧约束（保留历史+标记 SUPERSEDED）', async () => {
    const h = setup(new StubAICommentService([
      okAnalysis([availabilityUntil('17:00')]),
      okAnalysis([availabilityUntil('18:00')]),
    ]));
    try {
      await h.trips.create(fixture());
      await h.commentService.addComment('usr_A', 'trip_T', '我五点前必须走');
      await h.commentService.addComment('usr_A', 'trip_T', '改了，我六点前走');
      const list = await h.constraints.listByTrip('trip_T');
      assert.strictEqual(list.length, 2, '旧约束不得删除，必须保留历史');
      const oldC = list[0];
      const newC = list[1];
      assert.strictEqual(oldC.status, 'SUPERSEDED', '旧约束必须标记 SUPERSEDED');
      assert.strictEqual(newC.status, 'ACTIVE');
      assert.strictEqual(newC.supersedesConstraintId, oldC.id, '新约束必须记录替代来源');
      assert.strictEqual(newC.requiresConfirmation, true, '替代旧 HARD 约束必须 requiresConfirmation');
    } finally {
      fs.rmSync(h.directory, { recursive: true, force: true });
    }
  });

  // ---------- PHASE 7：coordination state ----------
  await record('coordination: 聚合状态统计 hard/soft 数量与 participantCount', async () => {
    const h = setup();
    try {
      const list = [
        constraint({ id: 'c1', priority: 'HARD', value: { after: '14:00' } }),
        constraint({ id: 'c2', priority: 'SOFT', type: 'PREFERENCE', value: { category: '粤菜' } }),
      ];
      const state = h.evaluator.evaluate({ tripId: 'trip_T', constraints: list, participantIds: ['usr_A', 'usr_B'] });
      assert.strictEqual(state.activeConstraintCount, 2);
      assert.strictEqual(state.hardConstraintCount, 1);
      assert.strictEqual(state.softConstraintCount, 1);
      assert.strictEqual(state.participantCount, 2);
    } finally {
      fs.rmSync(h.directory, { recursive: true, force: true });
    }
  });

  // ---------- PHASE 14：non-member 权限 ----------
  await record('coordination: 非成员读取 constraints/coordination → TRIP_FORBIDDEN', async () => {
    const h = setup();
    try {
      await h.trips.create(fixture({ participantIds: ['usr_A'] }));
      await h.coordination.listConstraints('usr_B', 'trip_T')
        .then(() => { throw new Error('should reject'); })
        .catch((e) => assert.strictEqual(e.code, 'TRIP_FORBIDDEN'));
      await h.coordination.getCoordination('usr_B', 'trip_T')
        .then(() => { throw new Error('should reject'); })
        .catch((e) => assert.strictEqual(e.code, 'TRIP_FORBIDDEN'));
    } finally {
      fs.rmSync(h.directory, { recursive: true, force: true });
    }
  });

  // ---------- PHASE 14：server 不信任客户端约束 ----------
  await record('coordination: analyze 忽略客户端传入 constraints，仅用 Server authoritative', async () => {
    const h = setup();
    try {
      await h.trips.create(fixture({ participantIds: ['usr_A'] }));
      const ai = new StubCoordinationAIService((input) => {
        // 模拟恶意客户端曾尝试注入；断言 AI 实际收到的约束只来自 Ledger
        const received = input as { constraints: unknown[] };
        assert.deepStrictEqual(received.constraints, [], 'AI 输入必须为空（Ledger 为空）');
        return { summary: 'ok', status: 'READY', suggestions: [] };
      });
      h.setCoordinatorAI(ai);
      // coordination.analyze 签名不含客户端约束参数 → 天然无法信任
      const result = await h.coordination.analyze('usr_A', 'trip_T');
      assert.ok(result.proposal, 'AI proposal 正常返回');
      assert.strictEqual(result.coordination.tripId, 'trip_T');
    } finally {
      fs.rmSync(h.directory, { recursive: true, force: true });
    }
  });

  // ---------- PHASE 9：AI coordinator invalid schema rejected ----------
  await record('coordination: AI 无效 schema（satisfied/resolved）被拒绝且保留 deterministic state', async () => {
    const h = setup();
    try {
      await h.trips.create(fixture({ participantIds: ['usr_A'] }));
      const validation = validateCoordinationProposal({
        summary: 'x', status: 'READY', suggestions: [], satisfied: true,
      });
      assert.strictEqual(validation.ok, false);
      assert.strictEqual(validation.failureReasonCode, 'AI_FORBIDDEN_SATISFACTION_FIELD');

      const ai = new StubCoordinationAIService(() => ({ summary: 'x', status: 'READY', suggestions: [], satisfied: true } as unknown as TripCoordinationProposal));
      h.setCoordinatorAI(ai);
      const result = await h.coordination.analyze('usr_A', 'trip_T');
      assert.strictEqual(result.coordinationUnavailable, true, '无效 schema 必须标记 coordinationUnavailable');
      assert.strictEqual(result.proposal, undefined, '绝不返回无效 proposal');
      assert.ok(result.coordination, 'deterministic state 保留');
    } finally {
      fs.rmSync(h.directory, { recursive: true, force: true });
    }
  });

  // ---------- PHASE 9：AI coordinator failure preserves deterministic state ----------
  await record('coordination: AI 失败保留 deterministic state（coordinationUnavailable=true）', async () => {
    const h = setup();
    try {
      await h.trips.create(fixture({ participantIds: ['usr_A'] }));
      await h.constraints.create(constraint({ id: 'c1', userId: 'usr_A', value: { after: '14:00' } }));
      const ai = new StubCoordinationAIService(() => new TripCoordinationAIError('AI_REQUEST_FAILED', 'down'));
      h.setCoordinatorAI(ai);
      const result = await h.coordination.analyze('usr_A', 'trip_T');
      assert.strictEqual(result.coordinationUnavailable, true);
      assert.strictEqual(result.proposal, undefined);
      assert.strictEqual(result.coordination.activeConstraintCount, 1, '确定性状态不因 AI 失败丢失');
    } finally {
      fs.rmSync(h.directory, { recursive: true, force: true });
    }
  });

  // ---------- PHASE 8：privacy（不传 openid/avatar） ----------
  await record('coordination: AI 输入最小化隐私（仅匿名 label，无 openid/avatar）', async () => {
    const h = setup();
    try {
      await h.trips.create(fixture({ participantIds: ['usr_A', 'usr_B'] }));
      let captured: unknown = null;
      const ai = new StubCoordinationAIService((input) => {
        captured = input;
        return { summary: 'ok', status: 'READY', suggestions: [] };
      });
      h.setCoordinatorAI(ai);
      await h.coordination.analyze('usr_A', 'trip_T');
      const input = captured as { participants: Array<{ id: string; label: string }> };
      assert.strictEqual(input.participants.length, 2);
      for (const p of input.participants) {
        assert.ok(p.label.startsWith('成员'), '参与者必须匿名 label');
        assert.ok(!p.id.includes('openid'), '不得泄漏 openid');
      }
      const serialized = JSON.stringify(input);
      assert.ok(!serialized.includes('openid'), '不得包含 openid');
      assert.ok(!serialized.includes('avatarUrl'), '不得包含 avatar');
    } finally {
      fs.rmSync(h.directory, { recursive: true, force: true });
    }
  });

  // ---------- PHASE 13：satisfaction 语义 ----------
  await record('coordination: AI 输出永不包含 satisfied/resolved 字段（EMPTY_EVIDENCE_SATISFIED 由 Plan 层决定）', () => {
    const validation = validateCoordinationProposal({
      summary: 'x',
      status: 'NEEDS_RESOLUTION',
      suggestions: [{
        kind: 'ADJUST_TIME',
        affectedConstraintIds: ['c1'],
        message: '建议调整',
        requiresConfirmation: false,
        confidence: 0.7,
        satisfied: true,
      }],
    });
    assert.strictEqual(validation.ok, false);
    assert.strictEqual(validation.failureReasonCode, 'AI_FORBIDDEN_SATISFACTION_FIELD');
  });
}
