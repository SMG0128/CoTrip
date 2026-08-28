// 评论：共享实体（Trip）下的独立记录，一条一档。
// userId 仅表示「评论作者」，绝不是评论流列表的读取范围——读取必须按 tripId。

import { AICommentAnalysis, AICommentSource } from './ai-comment';

export type CommentAIStatus =
  | 'processing'
  | 'accepted'
  | 'conflict'
  | 'unresolved'
  | 'waiting_confirm';

export interface Comment {
  id: string;
  /** 归属的共享实体（行程/房间）：评论流的唯一读取范围 */
  tripId: string;
  /** 评论作者（由认证身份注入，客户端不可自报） */
  userId: string;
  /** 用户原始文本，必须保留（用于展示/重新解析/审计） */
  rawText: string;
  createdAt: string;
  /** 服务端权威解析状态；客户端不得根据数组顺序或本地 Parser 重算覆盖。 */
  aiStatus: CommentAIStatus;
  /** 调试/审计来源；未配置 Provider 时为 none，绝不伪装成真实 AI。 */
  aiSource: AICommentSource;
  /** 仅保存通过 schema + domain validation 的结构化结果。 */
  aiAnalysis?: AICommentAnalysis;
}

/** 评论 API 的公开作者投影；不包含 openid、session_key 或其它认证字段。 */
export interface CommentAuthor {
  id: string;
  nickname: string;
  avatarUrl: string;
}

/** 小程序可见 DTO；作者资料读取时动态投影，因此历史评论跟随用户最新资料。 */
export interface CommentDTO extends Comment {
  author: CommentAuthor;
}
