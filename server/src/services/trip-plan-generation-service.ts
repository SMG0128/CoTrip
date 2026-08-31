// AI Trip Pipeline V2 · Stage 2 编排：COMMENT_EVALUATION → 条件触发 INITIAL_GENERATION。
//
// 语义顺序（评论保存永远不依赖 AI 成功）：
//   评论已保存 → COMMENT_EVALUATION → 若满足触发条件 → INITIAL_GENERATION → 落 currentPlan
//
// 触发条件（三者同时成立，缺一不可）：
//   currentPlan 不存在
//   AND decision.relevant === true
//   AND decision.usable === true
//
// 明确不做（留给 Stage 3）：已有 currentPlan 时即使 updateRequired=true 也绝不更新，
// 不调用 TRIP_UPDATE。本文件只保存判断结果。
//
// 并发与幂等（§首版唯一性）：
//   1) 进程内 in-flight 闸门：同一 trip 同时只允许一次 INITIAL_GENERATION 在途。
//      Node 单线程下，「读 currentPlan → 检查闸门 → 占用闸门」之间没有 await，
//      因此这段是原子的，近同时到达的第二条 usable 评论必然看到闸门已被占用。
//   2) 提交点 compare-and-set：写入前重新读取权威 Trip，若 currentPlan 已存在则放弃本次结果，
//      绝不覆盖已有首版。闸门是内存态（重启即失效），CAS 才是最终保证。

import { Comment } from '../types/comment';
import { Trip } from '../types/trip';
import { TripRepository } from '../repositories/trip-repository';
import {
  CommentEvaluationAIInput,
  CommentEvaluationCommentInput,
  CommentEvaluationRecord,
} from '../types/ai-comment-evaluation';
import { InitialGenerationAIInput } from '../types/ai-initial-generation';
import {
  CommentEvaluationAIError,
  CommentEvaluationAIService,
} from './comment-evaluation-ai-service';
import {
  InitialGenerationAIError,
  InitialGenerationAIService,
} from './initial-generation-ai-service';
import {
  buildCommentEvaluationRecord,
  validateCommentEvaluationEnvelope,
} from './comment-evaluation-ai-validation';
import {
  buildTripPlanFromEnvelope,
  validateInitialGenerationEnvelope,
} from './initial-generation-ai-validation';
import { TripPreprocessTripInput } from '../types/ai-preprocess';

export interface ProcessCommentResult {
  /** 评估记录；成功评估或明确不可用，绝不伪造 */
  evaluation: CommentEvaluationRecord;
  /** 本次调用是否真正落库了首版行程 */
  planGenerated: boolean;
}

export class TripPlanGenerationService {
  /** 正在执行 INITIAL_GENERATION 的 tripId；进程内首版唯一性闸门 */
  private readonly generating = new Set<string>();

  constructor(
    private readonly trips: TripRepository,
    private readonly evaluationAI: CommentEvaluationAIService,
    private readonly generationAI: InitialGenerationAIService,
  ) {}

  /**
   * 评论已持久化之后调用。
   * 返回评估记录供上层附加到评论；本方法自身绝不修改评论。
   */
  async processComment(comment: Comment, trip: Trip): Promise<ProcessCommentResult> {
    const evaluation = await this.evaluateComment(comment, trip);
    if (evaluation.status !== 'evaluated') {
      // 评估未成功：绝不据此触发生成，也绝不把它当成「判定为不相关」
      return { evaluation, planGenerated: false };
    }
    if (!evaluation.relevant || !evaluation.usable) {
      // 无关评论、或 relevant 但 unusable（例如「我觉得可以」）都不得触发首版生成
      return { evaluation, planGenerated: false };
    }
    const planGenerated = await this.generateInitialPlanIfAbsent(comment, trip);
    return { evaluation, planGenerated };
  }

  private buildTripInput(trip: Trip): TripPreprocessTripInput {
    // 优先复用 PREPROCESS 落库的原始创建输入；缺席时由 Trip 字段重建（不虚构）
    return (
      trip.aiContext?.tripInput ?? {
        title: trip.title,
        initialBrief: trip.initialBrief,
        areaConstraint: trip.areaConstraint,
        timeRange: trip.timeRange,
      }
    );
  }

  /** 送入 AI 的评论视图：只带判断所需内容，不带作者身份 */
  private toCommentInput(comment: Comment): CommentEvaluationCommentInput {
    return {
      id: comment.id,
      rawText: comment.rawText,
      createdAt: comment.createdAt,
    };
  }

  private async evaluateComment(
    comment: Comment,
    trip: Trip,
  ): Promise<CommentEvaluationRecord> {
    const input: CommentEvaluationAIInput = {
      title: trip.title,
      tripInput: this.buildTripInput(trip),
      aiContext: trip.aiContext ?? null,
      comment: this.toCommentInput(comment),
    };

    try {
      const envelope = await this.evaluationAI.evaluateComment(input);
      const validation = validateCommentEvaluationEnvelope(envelope);
      if (!validation.ok) {
        console.warn(
          `COMMENT_EVALUATION 响应验证失败（${validation.failureReasonCode} @ ${validation.failurePath}）`,
        );
        return {
          status: 'unavailable',
          requestType: 'COMMENT_EVALUATION',
          evaluatedAt: new Date().toISOString(),
          reasonCode: 'AI_INVALID_RESPONSE',
        };
      }
      return buildCommentEvaluationRecord(envelope, new Date().toISOString());
    } catch (error) {
      const reasonCode =
        error instanceof CommentEvaluationAIError ? error.code : 'AI_REQUEST_FAILED';
      console.warn(`COMMENT_EVALUATION 调用失败（${reasonCode}）`);
      return {
        status: 'unavailable',
        requestType: 'COMMENT_EVALUATION',
        evaluatedAt: new Date().toISOString(),
        reasonCode,
      };
    }
  }

  /**
   * 仅当权威 Trip 仍无 currentPlan 时生成首版并落库。
   * 返回是否真正写入；任何拒绝路径都保持 currentPlan 原样。
   */
  private async generateInitialPlanIfAbsent(comment: Comment, trip: Trip): Promise<boolean> {
    const tripId = trip.id;

    // —— 以下同步段无 await，保证「查计划 → 查闸门 → 占闸门」原子 ——
    const beforeGate = await this.trips.findById(tripId);
    if (!beforeGate) return false;
    if (beforeGate.currentPlan) {
      // 已有首版：Stage 2 绝不重复生成，也绝不执行 TRIP_UPDATE
      return false;
    }
    if (this.generating.has(tripId)) {
      // 同一 trip 已有生成在途：近同时到达的第二条 usable 评论在此止步
      return false;
    }
    this.generating.add(tripId);
    // —— 同步段结束 ——

    try {
      const input: InitialGenerationAIInput = {
        title: beforeGate.title,
        tripInput: this.buildTripInput(beforeGate),
        aiContext: beforeGate.aiContext ?? null,
        triggeringComment: this.toCommentInput(comment),
      };

      const envelope = await this.generationAI.generateInitialTrip(input);
      const validation = validateInitialGenerationEnvelope(envelope);
      if (!validation.ok) {
        console.warn(
          `INITIAL_GENERATION 响应验证失败（${validation.failureReasonCode} @ ${validation.failurePath}），不写入 currentPlan`,
        );
        return false;
      }

      // 提交点 compare-and-set：重新读取权威 Trip，已有首版则放弃本次结果
      const latest = await this.trips.findById(tripId);
      if (!latest) return false;
      if (latest.currentPlan) {
        console.warn(`INITIAL_GENERATION 结果被放弃：trip ${tripId} 的首版已存在`);
        return false;
      }

      const plan = buildTripPlanFromEnvelope(envelope, tripId, new Date().toISOString());
      // 完整 snapshot 原子写入（仓库整体替换 + 临时文件 rename）
      await this.trips.update({ ...latest, currentPlan: plan });
      return true;
    } catch (error) {
      const reasonCode =
        error instanceof InitialGenerationAIError ? error.code : 'AI_REQUEST_FAILED';
      console.warn(`INITIAL_GENERATION 调用失败（${reasonCode}），currentPlan 保持缺省`);
      return false;
    } finally {
      this.generating.delete(tripId);
    }
  }
}
