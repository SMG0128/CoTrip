// 评论业务层：共享行程评论流的唯一读写边界。
// - 列表：成员校验后按 tripId 查询全部评论，绝不按作者过滤成「我的评论」
// - 追加：独立 INSERT，绝不覆盖评论集合（禁止 last-write-wins）
// - 认证身份只用于权限校验与作者标注

import { Comment, CommentAIStatus, CommentDTO } from '../types/comment';
import { CommentRepository } from '../repositories/comment-repository';
import { TripRepository } from '../repositories/trip-repository';
import { UserRepository } from '../repositories/user-repository';
import { Trip } from '../types/trip';
import { toPublicUser } from '../types/user';
import { AICommentAnalysis } from '../types/ai-comment';
import { AICommentService, AICommentServiceError } from './ai-comment-service';
import { ConstraintLedgerService } from './constraint-ledger-service';
import { AppError } from '../types/errors';

function generateCommentId(now: Date): string {
  return `comment_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
}

export class CommentService {
  constructor(
    private readonly comments: CommentRepository,
    private readonly trips: TripRepository,
    private readonly users: UserRepository,
    private readonly ai: AICommentService,
    /** 可选：注入后启用 Constraint Ledger 持久化（真实行程必须注入；单元测试可不注入） */
    private readonly ledger?: ConstraintLedgerService,
  ) {}

  /** 权限校验：目标 Trip 存在且当前用户为成员 */
  private async requireMember(userId: string, tripId: string): Promise<Trip> {
    const trip = await this.trips.findById(tripId);
    if (!trip) {
      throw new AppError(404, 'TRIP_NOT_FOUND', '行程不存在');
    }
    if (!trip.participantIds.includes(userId)) {
      throw new AppError(403, 'TRIP_FORBIDDEN', '无权查看该行程的评论');
    }
    return trip;
  }

  private async toDTO(comment: Comment): Promise<CommentDTO> {
    const author = await this.users.findById(comment.userId);
    if (!author) {
      throw new AppError(500, 'COMMENT_AUTHOR_NOT_FOUND', '评论作者资料不存在');
    }
    const publicUser = toPublicUser(author);
    return {
      ...comment,
      author: {
        id: publicUser.id,
        nickname: publicUser.nickname,
        avatarUrl: publicUser.avatarUrl,
      },
    };
  }

  /** 读取共享行程全部评论：同一行程的所有成员看到同一条评论流 */
  async listComments(userId: string, tripId: string): Promise<CommentDTO[]> {
    await this.requireMember(userId, tripId);
    const comments = await this.comments.listByTrip(tripId);
    return Promise.all(comments.map((comment) => this.toDTO(comment)));
  }

  /** 追加评论：独立落库（绝不覆盖已有评论）；作者身份由认证注入 */
  async addComment(userId: string, tripId: string, rawText: string): Promise<CommentDTO> {
    const text = rawText.trim();
    if (!text) {
      throw new AppError(400, 'COMMENT_INVALID_INPUT', '评论内容不能为空');
    }
    const trip = await this.requireMember(userId, tripId);
    const now = new Date();
    const comment: Comment = {
      id: generateCommentId(now),
      tripId,
      userId,
      rawText: text,
      createdAt: now.toISOString(),
      aiStatus: 'processing',
      aiSource: 'none',
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
    const analyzed = await this.analyzeAndPersist(comment, trip);
    return this.toDTO(analyzed);
  }

  private async analyzeAndPersist(comment: Comment, trip: Trip): Promise<Comment> {
    const existing = await this.comments.listByTrip(trip.id);
    const existingRelevantConstraints = existing.flatMap(
      (candidate) => candidate.id === comment.id ? [] : candidate.aiAnalysis?.constraints ?? [],
    );

    try {
      const analysis = await this.ai.analyzeComment({
        trip: {
          id: trip.id,
          title: trip.title,
          initialBrief: trip.initialBrief,
          timeRange: trip.timeRange,
        },
        comment: {
          id: comment.id,
          tripId: comment.tripId,
          userId: comment.userId,
          rawText: comment.rawText,
          createdAt: comment.createdAt,
        },
        currentPlan: trip.currentPlan ?? null,
        existingRelevantConstraints,
      });
      // 约束持久化必须在评论状态更新前完成：
      // comment 已落库 → AI 成功 → constraint 写入 Ledger → 评论权威状态更新
      if (this.ledger) {
        const constraints = await this.ledger.persistFromAnalysis(
          {
            tripId: trip.id,
            commentId: comment.id,
            userId: comment.userId,
            createdAt: comment.createdAt,
          },
          analysis,
        );
        if (constraints.length === 0) {
          // AI 声称有约束但全部无法规范化持久化：不伪造权威状态
          const unresolved: Comment = {
            ...comment,
            aiStatus: 'unresolved',
            aiSource: this.ai.source,
          };
          return this.comments.update(unresolved);
        }
      }
      const updated: Comment = {
        ...comment,
        aiStatus: statusForAnalysis(analysis),
        aiSource: this.ai.source,
        aiAnalysis: analysis,
      };
      return this.comments.update(updated);
    } catch (error) {
      const updated: Comment = {
        ...comment,
        aiStatus: 'unresolved',
        aiSource: error instanceof AICommentServiceError && error.code === 'AI_NOT_CONFIGURED'
          ? 'none'
          : this.ai.source,
      };
      return this.comments.update(updated);
    }
  }
}

function statusForAnalysis(analysis: AICommentAnalysis): CommentAIStatus {
  if (analysis.requiresConfirmation) return 'waiting_confirm';
  if (
    (analysis.intent === 'constraint' || analysis.intent === 'preference')
    && analysis.constraints.length > 0
  ) {
    return 'accepted';
  }
  return 'unresolved';
}
