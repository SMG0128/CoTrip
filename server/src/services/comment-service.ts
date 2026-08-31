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
import { TripPlanGenerationService } from './trip-plan-generation-service';
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
    /**
     * 可选：注入后启用 AI Trip Pipeline V2 Stage 2
     * （COMMENT_EVALUATION → 首条 usable 评论触发 INITIAL_GENERATION）。
     * 未注入时评论行为与 Stage 1 完全一致。
     */
    private readonly planGeneration?: TripPlanGenerationService,
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
    // Stage 2：评论已权威落库之后才进入 COMMENT_EVALUATION → 条件触发 INITIAL_GENERATION。
    // 该阶段任何失败都不得影响评论本身（评论此刻已保存成功）。
    const evaluated = await this.runPlanPipeline(analyzed, trip);
    return this.toDTO(evaluated);
  }

  /**
   * COMMENT_EVALUATION（+ 条件触发 INITIAL_GENERATION）。
   * 传入的 comment 必须是 analyzeAndPersist 之后的最新版本，
   * 否则附加 evaluation 时会覆盖掉刚写入的 aiAnalysis。
   *
   * 优雅降级：AI 超时/不可用/响应非法/评估记录写库失败，一律返回已保存的评论，
   * 绝不抛出到 addComment，也绝不伪造 evaluation 或 currentPlan。
   */
  private async runPlanPipeline(comment: Comment, trip: Trip): Promise<Comment> {
    if (!this.planGeneration) return comment;
    try {
      const result = await this.planGeneration.processComment(comment, trip);
      return await this.comments.update({ ...comment, evaluation: result.evaluation });
    } catch {
      // 评论主体已持久化；评估记录缺失时下次可重新评估，不阻断评论创建
      return comment;
    }
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
      // Production Readiness（REVIEW 6）—— 权威持久化顺序：
      //   1) 先落盘评论权威状态（accepted + aiAnalysis）：analysis 是唯一可重放权威源，
      //      无论后续 ledger 是否失败都不丢失，backfill 可自愈。
      //   2) 再 materialize Constraint Ledger（幂等）。
      //   3) ledger 返回空（AI 有约束但全部无法规范化）→ 评论标 unresolved（保留 aiAnalysis 供审计）。
      //   4) ledger 写失败 → 保持 accepted + aiAnalysis，不伪造「完全处理成功」也不丢失 analysis。
      const updated: Comment = {
        ...comment,
        aiStatus: statusForAnalysis(analysis),
        aiSource: this.ai.source,
        aiAnalysis: analysis,
      };
      const persisted = await this.comments.update(updated);
      if (this.ledger) {
        try {
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
            // AI 声称有约束但全部无法规范化持久化：不伪造权威状态（保留 aiAnalysis）
            return this.comments.update({ ...persisted, aiStatus: 'unresolved' });
          }
        } catch {
          // Ledger materialization 暂时失败：评论保持 accepted + aiAnalysis（权威源已落盘），
          // 下次读取/backfill 自动 reconciliation；不把整体状态标成「完全处理成功」。
        }
      }
      return persisted;
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
