// Coordinator AI 输出的严格 schema。
// 约束：AI 只能解释/排序/建议，不得设置 satisfied、不得修改 Constraint Ledger。

export type TripCoordinationStatus =
  | 'READY'
  | 'NEEDS_RESOLUTION'
  | 'NEEDS_CONFIRMATION';

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

export interface TripCoordinationProposal {
  summary: string;
  status: TripCoordinationStatus;
  suggestions: TripCoordinationSuggestion[];
}
