// AI 评论分析的严格领域协议。Provider 只能返回这里允许的结构化值。

export type AICommentIntent = 'constraint' | 'preference' | 'chat' | 'unclear';
export type AICommentSource = 'provider' | 'rule_fallback' | 'none';

export type ConstraintDraftType = 'AVAILABILITY' | 'LOCATION' | 'BUDGET' | 'PREFERENCE';
export type ConstraintDraftScope = 'TRIP' | 'SPORT' | 'DINING' | 'TRANSPORT';
export type ConstraintDraftPriority = 'HARD' | 'SOFT';

export interface ConstraintDraft {
  type: ConstraintDraftType;
  scope: ConstraintDraftScope;
  priority: ConstraintDraftPriority;
  value: Record<string, unknown>;
}

export interface AICommentAnalysis {
  intent: AICommentIntent;
  constraints: ConstraintDraft[];
  confidence: number;
  requiresConfirmation: boolean;
  summary?: string;
}

/** 发送给 Provider 的最小行程上下文，主动排除 participantIds 等身份信息。 */
export interface AICommentTripContext {
  id: string;
  title: string;
  initialBrief: string;
  timeRange?: unknown;
}

export interface AnalyzeCommentInput {
  trip: AICommentTripContext;
  comment: {
    id: string;
    tripId: string;
    userId: string;
    rawText: string;
    createdAt: string;
  };
  currentPlan: unknown;
  existingRelevantConstraints: ConstraintDraft[];
}
