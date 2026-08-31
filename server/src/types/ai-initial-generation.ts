// AI Trip Pipeline V2 · INITIAL_GENERATION 类型。
//
// 首条 relevant=true && usable=true 的评论（且 currentPlan 尚不存在）触发首版行程生成。
// 与 COMMENT_EVALUATION 相反：这里 trip 必须非 null，且必须是**完整 snapshot**，
// 不是自然语言 patch、不是「变化内容」。
//
// 产品不变量（AI 不虚构真实世界事实）：AI 只描述做什么 / 什么时候 / 地点要求，
// 绝不产出已验证的场馆、坐标、价格、评分。校验层主动拒绝这些字段。

import { TripAIContext, TripPreprocessTripInput } from './ai-preprocess';
import { AIEnvelopeBase, AIMeta, AIUIConfig } from './ai-envelope';
import { CommentEvaluationCommentInput } from './ai-comment-evaluation';
import { TripPlanEventType, TripPlanLocationRequirement, TripPlanTimeRange } from './trip-plan';

/** 首版生成不能只把当前评论扔给 AI：必须综合标题、原始创建输入与 PREPROCESS 上下文 */
export interface InitialGenerationAIInput {
  title: string;
  tripInput: TripPreprocessTripInput;
  aiContext: TripAIContext | null;
  /** 触发本次生成的第一条 relevant && usable 评论 */
  triggeringComment: CommentEvaluationCommentInput;
}

/** AI 线上格式的行程条目；经校验后映射为 TripPlanEvent */
export interface AITripItem {
  /**
   * 仅 TRIP_UPDATE 允许携带：引用旧计划中被保留/修改的条目 id。
   * INITIAL_GENERATION 不得携带（此时没有既有条目，id 由服务端生成）。
   */
  id?: string;
  type: TripPlanEventType;
  title: string;
  time: TripPlanTimeRange;
  locationRequirement?: TripPlanLocationRequirement;
  alternatives?: string[];
}

/** AI 返回的首版行程快照 */
export interface AITripSnapshot {
  title: string;
  summary: string;
  items: AITripItem[];
}

export interface InitialGenerationDecision {
  tripChanged: boolean;
}

/** INITIAL_GENERATION 统一 Envelope：trip 必须非 null */
export interface AIInitialGenerationEnvelope extends AIEnvelopeBase {
  schemaVersion: string;
  requestType: 'INITIAL_GENERATION';
  status: 'success';
  analysis: Record<string, unknown>;
  decision: InitialGenerationDecision;
  trip: AITripSnapshot;
  ui?: AIUIConfig;
  meta?: AIMeta;
}

/** 首版行程条目数上界：防止 AI 返回超长 itinerary 撑爆存储 */
export const INITIAL_GENERATION_MAX_ITEMS = 50;
export const INITIAL_GENERATION_SUMMARY_MAX_LENGTH = 500;
