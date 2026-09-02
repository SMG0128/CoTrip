// AI Trip Pipeline V2 · Stage 2 + Stage 3 编排：
//   COMMENT_EVALUATION → 条件触发 INITIAL_GENERATION（首版）或 TRIP_UPDATE（改版）
//
// 语义顺序（评论保存永远不依赖 AI 成功）：
//   评论已保存 → COMMENT_EVALUATION → 若满足触发条件 → 生成/更新 → 落 currentPlan
//
// 首版触发条件（currentPlan 不存在）：
//   relevant === true AND usable === true
//
// 更新触发条件（currentPlan 已存在）：
//   relevant === true AND usable === true AND updateRequired === true
//   —— updateRequired 是最终开关：「好的」「看起来不错」这类 relevant 但
//      updateRequired=false 的评论绝不改动计划。
//
// 并发与幂等：
//   首版 —— 进程内 in-flight 闸门 + 提交点存在性检查，保证首版唯一。
//   更新 —— 版本 compare-and-set：更新绑定 baseVersion，提交时要求
//           currentPlan.version === baseVersion。被抢先时不覆盖新版本，
//           而是做**一次**受控重读 + 重新生成（MAX_TRIP_UPDATE_ATTEMPTS=2），
//           仍冲突则放弃本次过期结果。绝不无限重试、绝不无条件覆盖、不引入分布式锁。

import { Comment } from '../types/comment';
import { Trip } from '../types/trip';
import { TripPlan } from '../types/trip-plan';
import { TripRepository } from '../repositories/trip-repository';
import { AIUIConfig, TripLatestAIUI, emptyAIUIConfig } from '../types/ai-envelope';
import {
  CommentEvaluationAIInput,
  CommentEvaluationCommentInput,
  CommentEvaluationRecord,
} from '../types/ai-comment-evaluation';
import { InitialGenerationAIInput } from '../types/ai-initial-generation';
import {
  MAX_TRIP_UPDATE_ATTEMPTS,
  TripUpdateAIInput,
  TripUpdateCommentEvaluationInput,
} from '../types/ai-trip-update';
import {
  CommentEvaluationAIError,
  CommentEvaluationAIService,
} from './comment-evaluation-ai-service';
import {
  InitialGenerationAIError,
  InitialGenerationAIService,
} from './initial-generation-ai-service';
import { TripUpdateAIError, TripUpdateAIService, UnavailableTripUpdateAIService } from './trip-update-ai-service';
import {
  buildCommentEvaluationRecord,
  validateCommentEvaluationEnvelope,
} from './comment-evaluation-ai-validation';
import {
  buildTripPlanFromEnvelope,
  validateInitialGenerationEnvelope,
} from './initial-generation-ai-validation';
import { buildUpdatedTripPlan, validateTripUpdateEnvelope } from './trip-update-ai-validation';
import { TripPreprocessTripInput } from '../types/ai-preprocess';
import {
  PostProcessInput,
  postProcessTripPlan,
} from './trip-plan-post-processor';
import { TencentLBSService } from './tencent-lbs-service';
import { TencentDirectionService } from './tencent-direction-service';
import { sanitizePlanForPersist } from './plan-persist-sanitizer';
import { buildTimeAnchor } from './trip-temporal-resolution';
import { hasExplicitPlanChangeSignal, judgeShouldForward } from './comment-judge';
import { diffTripPlans, summarizePlanOperations } from './trip-plan-diff';

export type PlanMutation = 'none' | 'initial_generation' | 'trip_update';

/** 确定性后处理依赖：可注入的 Tencent LBS（未配置时为 null，跳过 POI 解析） */
export interface TripPlanPostProcessor {
  postProcess(input: PostProcessInput): Promise<{ plan: TripPlan }>;
}

/** 默认后处理器：使用注入的 LBS 服务 + Tencent direction（真实路线参与排程） */
export class DefaultTripPlanPostProcessor implements TripPlanPostProcessor {
  constructor(
    private readonly lbs: TencentLBSService | null,
    private readonly directions: TencentDirectionService | null = null,
  ) {}

  async postProcess(input: PostProcessInput): Promise<{ plan: TripPlan }> {
    const result = await postProcessTripPlan(input, this.lbs, this.directions);
    return { plan: result.plan };
  }
}

export interface ProcessCommentResult {
  /** 评估记录；成功评估或明确不可用，绝不伪造 */
  evaluation: CommentEvaluationRecord;
  /** 本次调用对 currentPlan 实际做了什么 */
  mutation: PlanMutation;
}

export class TripPlanGenerationService {
  /** 正在执行 INITIAL_GENERATION 的 tripId；进程内首版唯一性闸门 */
  private readonly generating = new Set<string>();

  constructor(
    private readonly trips: TripRepository,
    private readonly evaluationAI: CommentEvaluationAIService,
    private readonly generationAI: InitialGenerationAIService,
    /** Stage 3：未注入时行为与 Stage 2 完全一致（永不更新计划） */
    private readonly updateAI: TripUpdateAIService = new UnavailableTripUpdateAIService(),
    /** 确定性后处理：时间锚定 / 时长 / 先后关系 / POI 解析；未注入时跳过 */
    private readonly postProcessor: TripPlanPostProcessor | null = null,
  ) {}

  /**
   * 评论已持久化之后调用。
   * 返回评估记录供上层附加到评论；本方法自身绝不修改评论。
   */
  async processComment(comment: Comment, trip: Trip): Promise<ProcessCommentResult> {
    const evaluation = await this.evaluateComment(comment, trip);
    if (evaluation.status !== 'evaluated') {
      // 评估未成功：绝不据此触发任何计划变更，也绝不当成「判定为不相关」
      return { evaluation, mutation: 'none' };
    }

    // JudgeAgent 最终放行（LLM 判定 + 确定性信号兜底，兜底只放行、不收紧）：
    // 「复杂但有效的行程表达」（多动作 / 省略主语 / 依赖当前 itinerary 上下文）不得被拦在 PlanAgent 之外。
    if (!evaluation.shouldForward) {
      // 无关评论、寒暄、噪音：不放行，不改动计划
      console.info(
        `JudgeAgent: judgeStatus=${evaluation.judgeStatus} intentDomain=${evaluation.intentDomain} shouldForward=false（${evaluation.reason}）`,
      );
      return { evaluation, mutation: 'none' };
    }

    const latest = await this.trips.findById(trip.id);
    if (!latest) return { evaluation, mutation: 'none' };

    if (!latest.currentPlan) {
      console.info(
        `JudgeAgent: status=evaluated shouldForward=true judgeStatus=${evaluation.judgeStatus} intentDomain=${evaluation.intentDomain} → 进入 PlanAgent（INITIAL_GENERATION）`,
      );
      const generated = await this.generateInitialPlanIfAbsent(comment, latest);
      return { evaluation, mutation: generated ? 'initial_generation' : 'none' };
    }

    // 已有计划：updateRequired 是最终开关（「好的」「看起来不错」这类评论绝不改动计划）。
    // 确定性兜底：复杂但明确要求改行程的表达（删/换/改/安排/提前/推后 + 复合顺序表达）
    // 即使 LLM 保守判为 updateRequired=false，仍交给 PlanAgent 评估。
    const effectiveUpdateRequired =
      evaluation.updateRequired || hasExplicitPlanChangeSignal(evaluation.signals, comment.rawText);
    if (!effectiveUpdateRequired) {
      console.info(
        `JudgeAgent: status=evaluated shouldForward=true judgeStatus=${evaluation.judgeStatus} updateRequired=false（计划不改）`,
      );
      return { evaluation, mutation: 'none' };
    }
    console.info(
      `JudgeAgent: status=evaluated shouldForward=true judgeStatus=${evaluation.judgeStatus} updateRequired=${effectiveUpdateRequired} → 进入 PlanAgent（TRIP_UPDATE）`,
    );
    const updated = await this.updatePlan(comment, latest, evaluation);
    return { evaluation, mutation: updated ? 'trip_update' : 'none' };
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

  private async evaluateComment(comment: Comment, trip: Trip): Promise<CommentEvaluationRecord> {
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
      const record = buildCommentEvaluationRecord(envelope, new Date().toISOString(), comment.rawText);
      const signalCounts = [
        `places=${record.signals.places.length}`,
        `time=${record.signals.timeExpressions.length}`,
        `duration=${record.signals.durationExpressions.length}`,
        `sequence=${record.signals.sequenceWords.length}`,
        `action=${record.signals.actionWords.length}`,
      ].join(' ');
      // 可观测性：只记录判定语义与信号数量，不记录完整用户评论 / LLM 原始输出
      console.info(
        `JudgeAgent: status=evaluated shouldForward=${record.shouldForward} judgeStatus=${record.judgeStatus} intentDomain=${record.intentDomain} signals={${signalCounts}}`,
      );
      return record;
    } catch (error) {
      const reasonCode =
        error instanceof CommentEvaluationAIError ? error.code : 'AI_REQUEST_FAILED';
      console.warn(`COMMENT_EVALUATION 调用失败（${reasonCode}）`);
      console.info(`JudgeAgent: status=unavailable reasonCode=${reasonCode}`);
      return {
        status: 'unavailable',
        requestType: 'COMMENT_EVALUATION',
        evaluatedAt: new Date().toISOString(),
        reasonCode,
      };
    }
  }

  /** 与新计划同一次原子写入的 UI 提示 */
  private buildLatestAIUI(
    requestType: TripLatestAIUI['requestType'],
    planVersion: number,
    ui: AIUIConfig | undefined,
    updatedAt: string,
  ): TripLatestAIUI {
    return {
      planVersion,
      requestType,
      ui: ui ?? emptyAIUIConfig(),
      updatedAt,
    };
  }

  /**
   * 仅当权威 Trip 仍无 currentPlan 时生成首版并落库。
   * 返回是否真正写入；任何拒绝路径都保持 currentPlan 原样。
   */
  private async generateInitialPlanIfAbsent(comment: Comment, trip: Trip): Promise<boolean> {
    const tripId = trip.id;

    // —— 以下同步段无 await，保证「查计划 → 查闸门 → 占闸门」原子 ——
    if (trip.currentPlan) return false;
    if (this.generating.has(tripId)) {
      // 同一 trip 已有首版生成在途：近同时到达的第二条 usable 评论在此止步
      return false;
    }
    this.generating.add(tripId);
    // —— 同步段结束 ——

    try {
      const input: InitialGenerationAIInput = {
        title: trip.title,
        tripInput: this.buildTripInput(trip),
        aiContext: trip.aiContext ?? null,
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

      // 提交点检查：重新读取权威 Trip，已有首版则放弃本次结果
      const latest = await this.trips.findById(tripId);
      if (!latest) return false;
      if (latest.currentPlan) {
        console.warn(`INITIAL_GENERATION 结果被放弃：trip ${tripId} 的首版已存在`);
        return false;
      }

      const updatedAt = new Date().toISOString();
      let plan = buildTripPlanFromEnvelope(envelope, tripId, updatedAt);
      // 确定性后处理：时间锚定到行程日期 / 时长 / 先后关系 / POI 解析。
      // 失败时保留 AI 意图文本，但未验证事实字段会在下方 sanitize 时被剥离（fail-closed）。
      if (this.postProcessor) {
        try {
          const processed = await this.postProcessor.postProcess({
            plan,
            timeRange: latest.timeRange as { start?: string; end?: string; timezone?: string } | undefined,
            commentText: comment.rawText,
            city: extractCity(latest.areaConstraint),
            routeMode: comment.rawText,
          });
          plan = processed.plan;
        } catch {
          // 后处理失败：保留 AI 意图文本；未验证事实由 sanitizePlanForPersist 剥离
        }
      }
      // 落库前不变量门禁（fail-closed）：剥离未验证 location/restaurant/时间，
      // 禁止 AI 生成的 POI id/经纬度/餐厅/rating/avgPrice 绕过验证进入最终 plan。
      const tripStartDate = buildTimeAnchor(
        latest.timeRange as { start?: string; end?: string; timezone?: string } | undefined,
      )?.startDate;
      plan = sanitizePlanForPersist(plan, tripStartDate);
      // 可观测性：PlanAgent 操作摘要（首版全量 ADD），不写完整 LLM 输出
      const operations = summarizePlanOperations(diffTripPlans(null, plan));
      console.info(
        `PlanAgent: operations=[${operations.types.join(',') || 'none'}] count=${operations.count}（首版 v${plan.version}）`,
      );
      // 完整 snapshot 与 UI 提示同一次原子写入
      await this.trips.update({
        ...latest,
        currentPlan: plan,
        latestAIUI: this.buildLatestAIUI('INITIAL_GENERATION', plan.version, validation.ui, updatedAt),
      });
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

  /**
   * TRIP_UPDATE：基于当前版本生成新版本，版本 compare-and-set 落库。
   *
   * 被其他更新抢先时不覆盖新版本，而是重新读取当前计划并重新生成一次
   * （总尝试次数上限 MAX_TRIP_UPDATE_ATTEMPTS）；仍冲突则放弃本次过期结果。
   */
  private async updatePlan(
    comment: Comment,
    trip: Trip,
    evaluation: Extract<CommentEvaluationRecord, { status: 'evaluated' }>,
  ): Promise<boolean> {
    const commentEvaluation: TripUpdateCommentEvaluationInput = {
      commentIntent: evaluation.commentIntent,
      relevant: evaluation.relevant,
      usable: evaluation.usable,
      updateRequired: evaluation.updateRequired,
      reason: evaluation.reason,
      // JudgeAgent 只负责放行；shouldForward/judgeStatus/intentDomain 供 PlanAgent 理解最小解析状态
      shouldForward: evaluation.shouldForward,
      judgeStatus: evaluation.judgeStatus,
      intentDomain: evaluation.intentDomain,
    };

    let base: Trip = trip;
    for (let attempt = 0; attempt < MAX_TRIP_UPDATE_ATTEMPTS; attempt += 1) {
      const basePlan: TripPlan | undefined = base.currentPlan;
      if (!basePlan) {
        // 计划在此期间被删除：Stage 3 不负责重建首版
        return false;
      }
      const baseVersion = basePlan.version;

      const input: TripUpdateAIInput = {
        title: base.title,
        tripInput: this.buildTripInput(base),
        aiContext: base.aiContext ?? null,
        currentPlan: basePlan,
        triggeringComment: this.toCommentInput(comment),
        commentEvaluation,
        baseVersion,
      };

      let envelope;
      try {
        envelope = await this.updateAI.updateTrip(input);
      } catch (error) {
        const reasonCode = error instanceof TripUpdateAIError ? error.code : 'AI_REQUEST_FAILED';
        console.warn(`TRIP_UPDATE 调用失败（${reasonCode}），currentPlan 保持 v${baseVersion}`);
        return false;
      }

      const validation = validateTripUpdateEnvelope(envelope, basePlan);
      if (!validation.ok) {
        console.warn(
          `TRIP_UPDATE 响应验证失败（${validation.failureReasonCode} @ ${validation.failurePath}），currentPlan 保持 v${baseVersion}`,
        );
        return false;
      }

      // —— 提交点 compare-and-set ——
      const latest = await this.trips.findById(base.id);
      if (!latest || !latest.currentPlan) return false;
      if (latest.currentPlan.version !== baseVersion) {
        // 已被其他更新抢先：绝不用过期结果覆盖更新后的计划
        console.warn(
          `TRIP_UPDATE 版本冲突：base v${baseVersion} → 当前 v${latest.currentPlan.version}`,
        );
        base = latest; // 受控重读，基于最新版本再生成一次
        continue;
      }

      const updatedAt = new Date().toISOString();
      let plan = buildUpdatedTripPlan(envelope, latest.currentPlan, updatedAt);
      // 确定性后处理：时间锚定 / 时长 / 先后关系 / POI 解析。
      // 失败时保留 AI 意图文本；未验证事实由 sanitizePlanForPersist 剥离（fail-closed）。
      if (this.postProcessor) {
        try {
          const processed = await this.postProcessor.postProcess({
            plan,
            timeRange: latest.timeRange as { start?: string; end?: string; timezone?: string } | undefined,
            commentText: comment.rawText,
            city: extractCity(latest.areaConstraint),
            routeMode: comment.rawText,
          });
          plan = processed.plan;
        } catch {
          // 后处理失败：保留 AI 意图文本；未验证事实由 sanitizePlanForPersist 剥离
        }
      }
      // 落库前不变量门禁（fail-closed）：剥离未验证 location/restaurant/时间
      const tripStartDate = buildTimeAnchor(
        latest.timeRange as { start?: string; end?: string; timezone?: string } | undefined,
      )?.startDate;
      plan = sanitizePlanForPersist(plan, tripStartDate);
      // 可观测性：PlanAgent 操作摘要（ADD/UPDATE/DELETE/MOVE），不写完整 LLM 输出
      const operations = summarizePlanOperations(diffTripPlans(basePlan, plan));
      console.info(
        `PlanAgent: operations=[${operations.types.join(',') || 'none'}] count=${operations.count}（base v${baseVersion} → v${plan.version}）`,
      );
      await this.trips.update({
        ...latest,
        currentPlan: plan,
        latestAIUI: this.buildLatestAIUI('TRIP_UPDATE', plan.version, validation.ui, updatedAt),
      });
      return true;
    }

    console.warn('TRIP_UPDATE 连续版本冲突，放弃本次过期结果（不重试、不覆盖）');
    return false;
  }
}

/** 从 areaConstraint 提取城市（用于 POI disambiguation）；缺省返回 undefined */
function extractCity(areaConstraint: unknown): string | undefined {
  if (!areaConstraint || typeof areaConstraint !== 'object') return undefined;
  const record = areaConstraint as Record<string, unknown>;
  if (typeof record.city === 'string' && record.city) return record.city;
  return undefined;
}
