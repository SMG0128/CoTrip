// services/comment-service.ts
// 评论服务契约：共享行程评论流的唯一前端边界。
// 评论流按共享实体（tripId）读写，绝不按当前用户过滤成「我的评论」。

import { Comment } from '../types/comment';

export interface CommentService {
  /** 拉取某个行程的全部评论：服务端为 source of truth，返回所有成员可见的评论 */
  listComments(tripId: string): Promise<Comment[]>;
  /** 追加一条评论：服务端独立落库（append），绝不覆盖已有评论 */
  addComment(tripId: string, rawText: string): Promise<Comment>;
}
