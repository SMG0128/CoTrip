// types/coordination.ts
// 行程协调状态与协调建议（前端投影 Server authoritative 结构）。
// 真实 Trip 只能消费 Server Constraint Ledger + Server conflict evaluator + 真实 AI coordination service，
// 禁止 fallback 到 frontend rule parser / mock constraints / mock coordination。

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
  constraintIds: string[];
  participantUserIds: string[];
  reasonCode: TripConflictReasonCode;
  status: TripConflictStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SupersessionCandidate {
  oldConstraintId: string;
  newConstraintId: string;
  userId: string;
  type: string;
  scope: string;
}

/** Server authoritative coordination state（deterministic evaluator 生成） */
export interface TripCoordinationState {
  tripId: string;
  activeConstraintCount: number;
  hardConstraintCount: number;
  softConstraintCount: number;
  participantCount: number;
  commonAvailability?: { after?: string; until?: string };
  commonBudget?: { min?: number; max?: number };
  hardConflicts: TripConflict[];
  softTensions: TripConflict[];
  supersessionCandidates: SupersessionCandidate[];
  requiresConfirmation: boolean;
  updatedAt: string;
}

export type TripCoordinationStatus = 'READY' | 'NEEDS_RESOLUTION' | 'NEEDS_CONFIRMATION';
export type TripCoordinationSuggestionKind =
  | 'ADJUST_TIME'
  | 'RELAX_SOFT_PREFERENCE'
  | 'REQUEST_CONFIRMATION'
  | 'PRIORITIZE_PROXIMITY'
  | 'OTHER';

export interface TripCoordinationSuggestion {
  kind: TripCoordinationSuggestionKind;
  affectedConstraintIds: string[];
  message: string;
  requiresConfirmation: boolean;
  confidence: number;
}

/** AI 协调建议：只展示为「建议」，绝不伪装成最终计划 */
export interface TripCoordinationProposal {
  summary: string;
  status: TripCoordinationStatus;
  suggestions: TripCoordinationSuggestion[];
}

export interface CoordinationResponse {
  coordination: TripCoordinationState;
  proposal?: TripCoordinationProposal;
  coordinationUnavailable: boolean;
}
