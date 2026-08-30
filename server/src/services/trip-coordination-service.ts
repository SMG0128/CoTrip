// 协调服务：Trip 协调状态的权威来源。
//   - 只读 coordination：tripId → repositories → deterministic evaluator（AI 不参与）
//   - analyze：server 自行加载 authoritative constraints → evaluator → AI proposal
//     （绝不信任客户端传入的 constraints）
//   - AI 失败/无效响应：保留 deterministic state + coordinationUnavailable=true，绝不伪造 proposal。
//   - Production Readiness（REVIEW 5/16）：读取/分析前 lazy reconciliation —— 把已持久化的
//     legacy comment.aiAnalysis 幂等补写进 Constraint Ledger（不调 AI、不消耗 Token）。

import { TripRepository } from '../repositories/trip-repository';
import { ConstraintRepository } from '../repositories/constraint-repository';
import { CommentRepository } from '../repositories/comment-repository';
import { TripConstraint, TripConstraintScope, TripConstraintType } from '../types/trip-constraint';
import { TripConstraintEvaluator } from './trip-constraint-evaluator';
import { TripCoordinationAIService, TripCoordinationAIError } from './trip-coordination-ai-service';
import { TripCoordinationState } from '../types/trip-coordination';
import { TripCoordinationProposal } from '../types/trip-coordination-proposal';
import { validateCoordinationProposal } from './trip-coordination-ai-validation';
import { AppError } from '../types/errors';
import {
  AIDeterministicEvaluation,
  AISupersessionCandidate,
  TripCoordinationAIConflict,
  TripCoordinationAIConstraint,
  TripCoordinationAIInput,
} from '../types/trip-coordination-ai-input';
import { ConstraintLedgerService } from './constraint-ledger-service';

export interface CoordinationResult {
  coordination: TripCoordinationState;
  proposal?: TripCoordinationProposal;
  coordinationUnavailable: boolean;
}

export class TripCoordinationService {
  constructor(
    private readonly trips: TripRepository,
    private readonly constraints: ConstraintRepository,
    private readonly evaluator: TripConstraintEvaluator,
    private readonly ai: TripCoordinationAIService,
    private readonly comments: CommentRepository,
    private readonly ledger: ConstraintLedgerService,
  ) {}

  /** 成员校验 + 返回 Trip */
  private async requireMember(userId: string, tripId: string) {
    const trip = await this.trips.findById(tripId);
    if (!trip) {
      throw new AppError(404, 'TRIP_NOT_FOUND', '行程不存在');
    }
    if (!trip.participantIds.includes(userId)) {
      throw new AppError(403, 'TRIP_FORBIDDEN', '无权访问该行程的协调状态');
    }
    return trip;
  }

  /**
   * Lazy reconciliation（REVIEW 5/16）：部署新版后，旧生产数据的 comment.aiAnalysis
   * 自动幂等补写进 Constraint Ledger。失败不阻断只读协调（保留已加载约束），
   * 下次调用自动重试；绝不调用 AI。
   */
  private async reconcileLedger(tripId: string): Promise<void> {
    try {
      const comments = await this.comments.listByTrip(tripId);
      await this.ledger.backfillFromComments(comments);
    } catch {
      // backfill 失败：保留当前 Ledger，等待下次调用重试；不伪造任何成功
    }
  }

  /** 读取 Trip Constraint Ledger（成员可见） */
  async listConstraints(userId: string, tripId: string): Promise<TripConstraint[]> {
    await this.requireMember(userId, tripId);
    return this.constraints.listByTrip(tripId);
  }

  /** 读取协调状态：纯确定性，不调用 AI */
  async getCoordination(userId: string, tripId: string): Promise<CoordinationResult> {
    const trip = await this.requireMember(userId, tripId);
    await this.reconcileLedger(tripId);
    const constraints = await this.constraints.listByTrip(tripId);
    const coordination = this.evaluator.evaluate({
      tripId,
      constraints,
      participantIds: trip.participantIds,
    });
    return { coordination, coordinationUnavailable: false };
  }

  /**
   * 分析并生成 AI 协调建议。
   * Server 自行加载 authoritative constraints，忽略客户端传入的任何 constraint 数据。
   */
  async analyze(userId: string, tripId: string): Promise<CoordinationResult> {
    const trip = await this.requireMember(userId, tripId);
    await this.reconcileLedger(tripId);
    const constraints = await this.constraints.listByTrip(tripId);
    const activeConstraints = constraints.filter((constraint) => constraint.status === 'ACTIVE');
    const coordination = this.evaluator.evaluate({
      tripId,
      constraints,
      participantIds: trip.participantIds,
    });

    const input: TripCoordinationAIInput = this.buildAIInput(trip, tripId, activeConstraints, coordination);

    try {
      const rawProposal = await this.ai.analyzeCoordination(input);
      const validation = validateCoordinationProposal(rawProposal);
      if (!validation.ok) {
        // 无效 schema：保留 deterministic state，不返回伪造 proposal
        return { coordination, coordinationUnavailable: true };
      }
      return { coordination, proposal: rawProposal, coordinationUnavailable: false };
    } catch (error) {
      if (error instanceof TripCoordinationAIError) {
        return { coordination, coordinationUnavailable: true };
      }
      throw error;
    }
  }

  /**
   * 构建 AI 输入（REVIEW 13 — 隐私最小化）：
   *   - participants 只传匿名 label（成员A/成员B），不传任何 id
   *   - constraints 去掉 id/tripId/userId/sourceCommentId/时间戳，作者用 authorLabel 匿名标识
   *   - conflicts / supersessionCandidates 的参与者 id → participantLabels / authorLabel
   *   - deterministicEvaluation 保持 Server 权威数字不变（AI 只解释，不重算）
   */
  private buildAIInput(
    trip: { participantIds: string[] },
    tripId: string,
    constraints: TripConstraint[],
    coordination: TripCoordinationState,
  ): TripCoordinationAIInput {
    const labelByUserId = new Map<string, string>();
    trip.participantIds.forEach((id, index) => {
      labelByUserId.set(id, `成员${String.fromCharCode(65 + (index % 26))}`);
    });
    const labelFor = (userId: string): string => labelByUserId.get(userId) ?? '成员';

    const sanitizeConflict = (conflict: TripCoordinationState['hardConflicts'][number]): TripCoordinationAIConflict => ({
      id: conflict.id,
      kind: conflict.kind,
      dimension: conflict.dimension,
      reasonCode: conflict.reasonCode,
      status: conflict.status,
      constraintIds: [...conflict.constraintIds],
      participantLabels: conflict.participantUserIds.map(labelFor),
    });

    const sanitizeState = (state: TripCoordinationState): AIDeterministicEvaluation => ({
      tripId: state.tripId,
      activeConstraintCount: state.activeConstraintCount,
      hardConstraintCount: state.hardConstraintCount,
      softConstraintCount: state.softConstraintCount,
      participantCount: state.participantCount,
      ...(state.commonAvailability ? { commonAvailability: state.commonAvailability } : {}),
      ...(state.commonBudget ? { commonBudget: state.commonBudget } : {}),
      requiresConfirmation: state.requiresConfirmation,
      updatedAt: state.updatedAt,
      hardConflicts: state.hardConflicts.map(sanitizeConflict),
      softTensions: state.softTensions.map(sanitizeConflict),
      supersessionCandidates: state.supersessionCandidates.map(
        (candidate): AISupersessionCandidate => ({
          oldConstraintId: candidate.oldConstraintId,
          newConstraintId: candidate.newConstraintId,
          authorLabel: labelFor(candidate.userId),
          type: candidate.type as TripConstraintType,
          scope: candidate.scope as TripConstraintScope,
        }),
      ),
    });

    const aiConstraints: TripCoordinationAIConstraint[] = constraints.map((constraint) => ({
      type: constraint.type,
      scope: constraint.scope,
      priority: constraint.priority,
      value: constraint.value,
      status: constraint.status,
      ...(constraint.supersedesConstraintId ? { supersedesConstraintId: constraint.supersedesConstraintId } : {}),
      requiresConfirmation: constraint.requiresConfirmation,
      authorLabel: labelFor(constraint.userId),
    }));

    return {
      tripId,
      participants: trip.participantIds.map(labelFor),
      constraints: aiConstraints,
      deterministicEvaluation: sanitizeState(coordination),
      conflicts: [...coordination.hardConflicts, ...coordination.softTensions].map(sanitizeConflict),
    };
  }
}
