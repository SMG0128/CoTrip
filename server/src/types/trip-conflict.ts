// Server deterministic conflict entity。
// 由 TripConstraintEvaluator（纯确定性逻辑）生成，不是 AI 生成。
// reasonCode 是机器可读常量，不是 AI 文案。

export type TripConflictKind = 'HARD_CONFLICT' | 'SOFT_TENSION';
export type TripConflictDimension = 'AVAILABILITY' | 'LOCATION' | 'BUDGET' | 'PREFERENCE';
export type TripConflictStatus = 'OPEN' | 'RESOLVED';

export type TripConflictReasonCode =
  | 'NO_COMMON_AVAILABILITY'
  | 'BUDGET_RANGE_EMPTY'
  | 'CITY_MISMATCH'
  | 'PREFERENCE_DIVERGENCE';

export interface TripConflict {
  id: string;
  tripId: string;
  kind: TripConflictKind;
  dimension: TripConflictDimension;
  /** 参与冲突的 constraint id（可追溯） */
  constraintIds: string[];
  /** 相关参与者（userId surrogate） */
  participantUserIds: string[];
  reasonCode: TripConflictReasonCode;
  status: TripConflictStatus;
  createdAt: string;
  updatedAt: string;
}
