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
   * 房间号（V0.3 UI Foundation，前端仅预留）。
   * 真实云端 Trip 当前不返回该字段；由后续服务器 Room API 正式生成。
   * 前端禁止自行从 trip.id / userId / timestamp 伪造。
   */
  roomCode?: string;
}