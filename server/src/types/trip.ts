// 后端独立 Trip 模型；不依赖微信小程序 runtime 类型。

import { TripAIContext } from './ai-preprocess';

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
  currentPlan?: unknown;
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
