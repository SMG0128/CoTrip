// 协调服务：Trip 协调状态的权威来源。
//   - 只读 coordination：tripId → repositories → deterministic evaluator（AI 不参与）
//   - analyze：server 自行加载 authoritative constraints → evaluator → AI proposal
//     （绝不信任客户端传入的 constraints）
//   - AI 失败/无效响应：保留 deterministic state + coordinationUnavailable=true，绝不伪造 proposal。

import { TripRepository } from '../repositories/trip-repository';
import { ConstraintRepository } from '../repositories/constraint-repository';
import { TripConstraint } from '../types/trip-constraint';
import { TripConstraintEvaluator } from './trip-constraint-evaluator';
import { TripCoordinationAIService, TripCoordinationAIError } from './trip-coordination-ai-service';
import { TripCoordinationState } from '../types/trip-coordination';
import { TripCoordinationProposal } from '../types/trip-coordination-proposal';
import { validateCoordinationProposal } from './trip-coordination-ai-validation';
import { AppError } from '../types/errors';
import { TripCoordinationAIInput } from '../types/trip-coordination-ai-input';

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

  /** 读取 Trip Constraint Ledger（成员可见） */
  async listConstraints(userId: string, tripId: string): Promise<TripConstraint[]> {
    await this.requireMember(userId, tripId);
    return this.constraints.listByTrip(tripId);
  }

  /** 读取协调状态：纯确定性，不调用 AI */
  async getCoordination(userId: string, tripId: string): Promise<CoordinationResult> {
    const trip = await this.requireMember(userId, tripId);
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

  /** 构建 AI 输入：最小化隐私 —— 参与者只传匿名 label，不传 openid/avatar */
  private buildAIInput(
    trip: { participantIds: string[] },
    tripId: string,
    constraints: TripConstraint[],
    coordination: TripCoordinationState,
  ): TripCoordinationAIInput {
    const participants = trip.participantIds
      .map((id, index) => ({
        id,
        label: `成员${String.fromCharCode(65 + (index % 26))}`,
      }));
    return {
      tripId,
      participants,
      constraints,
      deterministicEvaluation: coordination,
      conflicts: [...coordination.hardConflicts, ...coordination.softTensions],
    };
  }
}
