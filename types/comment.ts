// types/comment.ts
// 评论：保存用户原始输入，AI 状态用于展示处理进度。

export type AIStatus =
  | 'accepted'
  | 'processing'
  | 'partially_incorporated'
  | 'conflict'
  | 'unresolved'
  | 'waiting_confirm';

/** 原子意图覆盖：服务端按当前计划投影，前端用于「部分纳入 x / y」等低干扰提示 */
export interface CommentIntentCoverage {
  intents: Array<{
    id: string;
    kind: 'ACTIVITY' | 'PLACE' | 'MEAL';
    location?: string;
    action?: string;
    durationMinutes?: number;
    foodKeyword?: string;
    afterIntentId?: string;
  }>;
  entries: Array<{
    intent: {
      id: string;
      kind: 'ACTIVITY' | 'PLACE' | 'MEAL';
      location?: string;
      action?: string;
      durationMinutes?: number;
      foodKeyword?: string;
      afterIntentId?: string;
    };
    status: 'PLANNED' | 'UNRESOLVED' | 'REJECTED' | 'CONFLICT' | 'PENDING';
    matchedEventId?: string;
  }>;
  incorporation: 'INCORPORATED' | 'PARTIALLY_INCORPORATED' | 'UNRESOLVED';
  plannedCount: number;
  totalCount: number;
}

export type AICommentSource = 'provider' | 'rule_fallback' | 'none';

export interface CommentAuthor {
  id: string;
  nickname: string;
  avatarUrl: string;
}

export interface CommentConstraintDraft {
  type: 'AVAILABILITY' | 'LOCATION' | 'BUDGET' | 'PREFERENCE';
  scope: 'TRIP' | 'SPORT' | 'DINING' | 'TRANSPORT';
  priority: 'HARD' | 'SOFT';
  value: Record<string, unknown>;
}

export interface AICommentAnalysis {
  intent: 'constraint' | 'preference' | 'chat' | 'unclear';
  constraints: CommentConstraintDraft[];
  confidence: number;
  requiresConfirmation: boolean;
  summary?: string;
}

export interface Comment {
  id: string;
  tripId: string;
  userId: string;
  /** 用户原始文本，必须保留 */
  rawText: string;
  createdAt: string;
  aiStatus: AIStatus;
  /** 真实评论由服务端返回；Demo fixture 可省略。 */
  aiSource?: AICommentSource;
  /** 仅包含服务端 schema/domain validation 后的结构化结果。 */
  aiAnalysis?: AICommentAnalysis;
  /** 真实评论必须由服务端动态投影；Demo fixture 可通过隔离的 Mock 参与者解析。 */
  author?: CommentAuthor;
  /** 原子意图覆盖（服务端按当前计划投影）：全部 PLANNED → accepted；部分 → partially_incorporated */
  intentCoverage?: CommentIntentCoverage;
}
