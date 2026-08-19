// types/comment.ts
// 评论：保存用户原始输入，AI 状态用于展示处理进度。

export type AIStatus =
  | 'accepted'
  | 'processing'
  | 'conflict'
  | 'unresolved'
  | 'waiting_confirm';

export interface Comment {
  id: string;
  tripId: string;
  userId: string;
  /** 用户原始文本，必须保留 */
  rawText: string;
  createdAt: string;
  aiStatus: AIStatus;
}