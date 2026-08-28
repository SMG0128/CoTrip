// 评论存储接口：独立记录、按共享实体（tripId）读写。
// 约定：create 必须是追加（append），绝不覆盖已有评论；
//       读取按 tripId 过滤，绝不按作者（userId）过滤成「我的评论」。

import { Comment } from '../types/comment';

export interface CommentRepository {
  /** 追加一条评论；并发调用也必须串行原子追加，不丢任何一条 */
  create(comment: Comment): Promise<Comment>;
  /** 读取某个 Trip 的全部评论（按 createdAt 升序） */
  listByTrip(tripId: string): Promise<Comment[]>;
}
