// types/trip.ts
// 行程

import { AreaConstraint } from './constraint';
import { TimeRange } from './time';
import { Plan } from './plan';

export type TripStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export interface Trip {
  id: string;
  title: string;
  status: TripStatus;
  creatorId: string;
  participantIds: string[];
  createdAt: string;
  completedAt?: string;
  /** 创建时的自然语言简述 */
  initialBrief: string;
  areaConstraint?: AreaConstraint;
  timeRange?: TimeRange;
  currentPlan?: Plan;
  commentIds: string[];
  constraintIds: string[];
  /**
   * 服务器拥有的房间号；本地 Mock 仅提供固定开发值用于 Join 流程验收。
   * 前端禁止自行从 trip.id / userId / timestamp 伪造。
   */
  roomCode?: string;
}
