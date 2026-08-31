// AI Trip Pipeline V2 · TRIP_UPDATE 类型。
//
// 触发条件（全部成立才允许调用，缺一不可）：
//   currentPlan 已存在
//   AND evaluation.status === 'evaluated'
//   AND evaluation.relevant === true
//   AND evaluation.usable === true
//   AND evaluation.updateRequired === true
//
// 输出与 INITIAL_GENERATION 共用同一 trip snapshot 契约：必须返回**修改后的完整快照**，
// 禁止自然语言 patch、禁止只返回变化内容、禁止前端自行解释 diff。

import { TripAIContext, TripPreprocessTripInput } from './ai-preprocess';
import { AIEnvelopeBase, AIMeta, AIUIConfig } from './ai-envelope';
import { CommentEvaluationCommentInput } from './ai-comment-evaluation';
import { AITripSnapshot } from './ai-initial-generation';
import { TripPlan } from './trip-plan';

/**
 * 送入更新模型的评论判断结果（受控结构化投影）。
 * 只带对更新有帮助的字段，绝不带作者身份、原始 AI 响应或 prompt。
 */
export interface TripUpdateCommentEvaluationInput {
  commentIntent: string;
  relevant: boolean;
  usable: boolean;
  updateRequired: boolean;
  reason: string;
}

/**
 * TRIP_UPDATE 的 AI 输入。
 * 更新模型不得只看当前评论：必须同时拿到标题、原始创建输入、PREPROCESS 上下文
 * 与当前完整有效 itinerary。隐私最小化沿用 Stage 2：无 userId、无 secret、
 * 无完整数据库对象、无不相关评论、无无界历史。
 */
export interface TripUpdateAIInput {
  title: string;
  tripInput: TripPreprocessTripInput;
  aiContext: TripAIContext | null;
  /** 当前完整有效 itinerary snapshot */
  currentPlan: TripPlan;
  triggeringComment: CommentEvaluationCommentInput;
  commentEvaluation: TripUpdateCommentEvaluationInput;
  /**
   * 本次更新所基于的计划版本。
   * 提交时必须仍等于 currentPlan.version 才允许落库（compare-and-set）。
   */
  baseVersion: number;
}

export interface TripUpdateDecision {
  tripChanged: true;
}

/** TRIP_UPDATE 统一 Envelope：trip 必须非 null 且 tripChanged === true */
export interface AITripUpdateEnvelope extends AIEnvelopeBase {
  schemaVersion: string;
  requestType: 'TRIP_UPDATE';
  status: 'success';
  analysis: Record<string, unknown>;
  decision: TripUpdateDecision;
  trip: AITripSnapshot;
  ui?: AIUIConfig;
  meta?: AIMeta;
}

/** 单次评论最多允许的 TRIP_UPDATE 尝试次数：首次 + 一次受控重读重生成，绝不无限重试 */
export const MAX_TRIP_UPDATE_ATTEMPTS = 2;
