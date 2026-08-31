// 后端独立 Trip 模型；不依赖微信小程序 runtime 类型。

import { TripAIContext } from './ai-preprocess';
import { TripPlan } from './trip-plan';
import { TripLatestAIUI } from './ai-envelope';

export type TripStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export interface Trip {
  id: string;
  title: string;
  status: TripStatus;
  creatorId: string;
  participantIds: string[];
  createdAt: string;
  completedAt?: string;
  /** V0.3 Room Identity：房间号由服务器生成，所有持久化 Trip 必须存在。 */
  roomCode: string;
  initialBrief: string;
  areaConstraint?: unknown;
  timeRange?: unknown;
  /**
   * AI Trip Pipeline V2 Stage 2：首条 relevant && usable 评论触发 INITIAL_GENERATION 后写入的
   * 首版完整行程 snapshot。创建行程时恒缺省——PREPROCESS 绝不生成 itinerary。
   */
  currentPlan?: TripPlan;
  /**
   * AI Trip Pipeline V2 Stage 3：最近一次 INITIAL_GENERATION / TRIP_UPDATE 的 UI 语义提示。
   * 与 currentPlan 同一次原子写入；planVersion 不等于当前计划版本时前端必须忽略。
   * 只保留最新一条，不保存历史、不保存 AI 原始响应。
   */
  latestAIUI?: TripLatestAIUI;
  commentIds: string[];
  constraintIds: string[];
  /** AI Trip Pipeline V2：创建时 PREPROCESS 生成的结构化上下文；AI 不可用或缺席时为 undefined */
  aiContext?: TripAIContext;
}

export interface CreateTripInput {
  title: string;
  initialBrief: string;
  areaConstraint?: unknown;
  timeRange?: unknown;
}

/** Join Landing 所需的最小公开投影；不得暴露任何用户身份字段。 */
export interface TripJoinPreview {
  roomCode: string;
  title: string;
  participantCount: number;
  status: TripStatus;
}
