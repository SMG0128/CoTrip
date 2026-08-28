// 评论业务层：共享行程评论流的唯一读写边界。
// - 列表：成员校验后按 tripId 查询全部评论，绝不按作者过滤成「我的评论」
// - 追加：独立 INSERT，绝不覆盖评论集合（禁止 last-write-wins）
// - 认证身份只用于权限校验与作者标注

import { Comment } from '../types/comment';
import { CommentRepository } from '../repositories/comment-repository';
import { TripRepository } from '../repositories/trip-repository';
import { AppError } from '../types/errors';

function generateCommentId(now: Date): string {
  return `comment_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
}

export class CommentService {
  constructor(
    private readonly comments: CommentRepository,
    private readonly trips: TripRepository
  ) {}

  /** 权限校验：目标 Trip 存在且当前用户为成员 */
  private async requireMember(userId: string, tripId: string): Promise<void> {
    const trip = await this.trips.findById(tripId);
    if (!trip) {
      throw new AppError(404, 'TRIP_NOT_FOUND', '行程不存在');
    }
    if (!trip.participantIds.includes(userId)) {
      throw new AppError(403, 'TRIP_FORBIDDEN', '无权查看该行程的评论');
    }
  }

  /** 读取共享行程全部评论：同一行程的所有成员看到同一条评论流 */
  async listComments(userId: string, tripId: string): Promise<Comment[]> {
    await this.requireMember(userId, tripId);
    return this.comments.listByTrip(tripId);
  }

  /** 追加评论：独立落库（绝不覆盖已有评论）；作者身份由认证注入 */
  async addComment(userId: string, tripId: string, rawText: string): Promise<Comment> {
    const text = rawText.trim();
    if (!text) {
      throw new AppError(400, 'COMMENT_INVALID_INPUT', '评论内容不能为空');
    }
    await this.requireMember(userId, tripId);
    const now = new Date();
    const comment: Comment = {
      id: generateCommentId(now),
      tripId,
      userId,
      rawText: text,
      createdAt: now.toISOString(),
    };
    // 独立 INSERT（追加），不是覆盖整个评论集合
    await this.comments.create(comment);
    // 同步冗余索引 trip.commentIds；失败不阻塞（评论已落库，列表始终以评论仓库为准）
    try {
      const trip = await this.trips.findById(tripId);
      if (trip && !trip.commentIds.includes(comment.id)) {
        await this.trips.update({ ...trip, commentIds: [...trip.commentIds, comment.id] });
      }
    } catch {
      // 评论主体已持久化；commentIds 仅作展示索引，缺失时可降级按评论仓库读取
    }
    return comment;
  }
}
