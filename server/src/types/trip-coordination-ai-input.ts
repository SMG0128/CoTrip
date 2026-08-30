// Coordinator AI 输入：Server 已验证后的结构化 coordination context。
// 隐私最小化（严格）：
//   - 绝不传 openid / unionid / token / avatarUrl / phone / email / auth headers
//   - 参与者只传匿名 label（成员A/成员B），不传任何真实 id
//   - constraints / conflicts / supersessionCandidates 中不传 userId surrogate，
//     只通过 authorLabel / participantLabels 匿名标识
// 语义约束：deterministicEvaluation 是 Server 权威输出，AI 不得重算或推翻。

import {
  TripConstraintPriority,
  TripConstraintScope,
  TripConstraintStatus,
  TripConstraintType,
} from './trip-constraint';
import {
  TripConflictDimension,
  TripConflictKind,
  TripConflictReasonCode,
  TripConflictStatus,
} from './trip-conflict';
import { TripCoordinationState } from './trip-coordination';

/** 脱敏后的约束视图（移除 id/tripId/userId/sourceCommentId/createdAt/updatedAt） */
export interface TripCoordinationAIConstraint {
  type: TripConstraintType;
  scope: TripConstraintScope;
  priority: TripConstraintPriority;
  value: Record<string, unknown>;
  status: TripConstraintStatus;
  supersedesConstraintId?: string;
  requiresConfirmation: boolean;
  /** 匿名作者标签（成员A/成员B），由 Server 映射生成 */
  authorLabel: string;
}

/** 脱敏后的冲突视图（participantUserIds → participantLabels） */
export interface TripCoordinationAIConflict {
  id: string;
  kind: TripConflictKind;
  dimension: TripConflictDimension;
  reasonCode: TripConflictReasonCode;
  status: TripConflictStatus;
  constraintIds: string[];
  participantLabels: string[];
}

/** 脱敏后的 supersession 候选（userId → authorLabel） */
export interface AISupersessionCandidate {
  oldConstraintId: string;
  newConstraintId: string;
  authorLabel: string;
  type: TripConstraintType;
  scope: TripConstraintScope;
}

/** 脱敏后的 deterministic evaluation：保持 Server 权威数字，参与者 id 一律匿名化 */
export interface AIDeterministicEvaluation
  extends Omit<TripCoordinationState, 'hardConflicts' | 'softTensions' | 'supersessionCandidates'> {
  hardConflicts: TripCoordinationAIConflict[];
  softTensions: TripCoordinationAIConflict[];
  supersessionCandidates: AISupersessionCandidate[];
}

export interface TripCoordinationAIInput {
  tripId: string;
  /** 仅匿名 label（成员A/成员B），无任何 id */
  participants: string[];
  constraints: TripCoordinationAIConstraint[];
  deterministicEvaluation: AIDeterministicEvaluation;
  conflicts: TripCoordinationAIConflict[];
}
