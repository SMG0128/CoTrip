// Server authoritative 聚合协调状态。
// 由 TripConstraintEvaluator（确定性逻辑）生成，不是 AI 生成。
// 前端只能消费该结构，不能本地重算覆盖。

import { TripConflict } from './trip-conflict';

export interface TripCoordinationState {
  tripId: string;
  activeConstraintCount: number;
  hardConstraintCount: number;
  softConstraintCount: number;
  participantCount: number;
  /** 确定性交集（无 HARD availability 约束时缺省） */
  commonAvailability?: { after?: string; until?: string };
  /** 确定性交集（无 HARD budget 约束时缺省） */
  commonBudget?: { min?: number; max?: number };
  hardConflicts: TripConflict[];
  softTensions: TripConflict[];
  /** supersession 候选：同 user+type+scope 的新旧约束，等待确认 */
  supersessionCandidates: {
    oldConstraintId: string;
    newConstraintId: string;
    userId: string;
    type: string;
    scope: string;
  }[];
  requiresConfirmation: boolean;
  updatedAt: string;
}
