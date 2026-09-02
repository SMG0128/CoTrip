// AI Trip Pipeline V2 · COMMENT_EVALUATION 类型。
//
// 每条新评论保存后、任何行程生成行为之前，必须先经过 COMMENT_EVALUATION。
// 核心不变量：评论判断阶段自己绝不生成 itinerary —— trip 恒为 null。
//
// requestType 复用 types/ai-preprocess.ts 的 AIRequestType，不另立第二套枚举。

import { AIRequestType, TripAIContext, TripPreprocessTripInput } from './ai-preprocess';
import { AIEnvelopeBase, AIMeta, AIUIConfig } from './ai-envelope';
import { JudgeIntentDomain, JudgeStatus, TripSignals } from './comment-judge';

/** 送入 AI 的评论视图：只带判断所需内容，不带作者身份（隐私最小化） */
export interface CommentEvaluationCommentInput {
  id: string;
  rawText: string;
  createdAt: string;
}

/** COMMENT_EVALUATION 的 AI 输入：title + 创建原始输入 + PREPROCESS 上下文 + 当前评论 */
export interface CommentEvaluationAIInput {
  title: string;
  tripInput: TripPreprocessTripInput;
  /** PREPROCESS 结构化结果；AI 不可用时创建流程不写 aiContext，故可能缺席 */
  aiContext: TripAIContext | null;
  comment: CommentEvaluationCommentInput;
}

/**
 * 三个 decision 字段语义严格区分：
 *   relevant       —— 评论是否与行程/活动/时间/地点/成员需求/饮食/交通/预算/约束/安排有关
 *   usable         —— 评论是否提供了规划系统可以实际消费的新信息、约束、选择或偏好
 *   updateRequired —— 在已存在 itinerary 的前提下，这条评论理论上是否要求修改 itinerary
 *
 * updateRequired 在 Stage 2 可以被正确判断并保存，但已有 itinerary 时禁止真正更新
 * currentPlan —— 那属于 Stage 3 的 TRIP_UPDATE。
 */
export interface CommentEvaluationDecision {
  relevant: boolean;
  usable: boolean;
  updateRequired: boolean;
  reason: string;
}

export interface CommentEvaluationAnalysis {
  commentIntent: string;
}

/** COMMENT_EVALUATION 统一 Envelope：trip 恒为 null */
export interface AICommentEvaluationEnvelope extends AIEnvelopeBase {
  schemaVersion: string;
  requestType: 'COMMENT_EVALUATION';
  status: 'success';
  analysis: CommentEvaluationAnalysis;
  decision: CommentEvaluationDecision;
  trip: null;
  ui?: AIUIConfig;
  meta?: AIMeta;
}

/** 评估失败的具名原因；绝不伪装成「判定为不相关」 */
export type CommentEvaluationFailureCode =
  | 'AI_NOT_CONFIGURED'
  | 'AI_REQUEST_FAILED'
  | 'AI_INVALID_RESPONSE';

/**
 * 持久化在 Comment 上的评估记录（有界、可供 Stage 3 判断「是否已评估过」）。
 *
 * 刻意做成可判别联合：只有真正评估成功才存在 decision 字段，
 * AI 失败时记录 status='unavailable' + 具名 reasonCode，绝不落成
 * relevant=false 之类看起来像真实判定的伪造结论。
 *
 * 绝不存储：AI 原始响应全文、内部 prompt。字符串字段一律截断，避免无界增长。
 */
export type CommentEvaluationRecord =
  | {
      status: 'evaluated';
      schemaVersion: string;
      requestType: Extract<AIRequestType, 'COMMENT_EVALUATION'>;
      evaluatedAt: string;
      commentIntent: string;
      relevant: boolean;
      usable: boolean;
      updateRequired: boolean;
      reason: string;
      /** JudgeAgent 放行语义（final）：true = 值得交给 PlanAgent（LLM 判定 + 确定性信号兜底） */
      shouldForward: boolean;
      /** JudgeAgent 状态（final）：actionable / irrelevant / insufficient / unsupported */
      judgeStatus: JudgeStatus;
      /** 意图域（final）：trip / non_trip / unknown */
      intentDomain: JudgeIntentDomain;
      /** 确定性抽取的最小行程信号（可观测性；不是 PlanAgent 的输入） */
      signals: TripSignals;
    }
  | {
      status: 'unavailable';
      requestType: Extract<AIRequestType, 'COMMENT_EVALUATION'>;
      evaluatedAt: string;
      reasonCode: CommentEvaluationFailureCode;
    };

/** 评估记录中字符串字段的上界，防止 AI 输出把评论文档撑爆 */
export const COMMENT_EVALUATION_INTENT_MAX_LENGTH = 120;
export const COMMENT_EVALUATION_REASON_MAX_LENGTH = 300;
