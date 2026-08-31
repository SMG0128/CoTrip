// types/trip.ts
// 行程

import { AreaConstraint } from './constraint';
import { TimeRange } from './time';
import { Plan } from './plan';
import { TripAIContext } from './ai-preprocess';

export type TripStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

/** 行程数据来源：缺省视为 'server'（后端真实数据）；'mock' 为内置示例行程，仅本地展示 */
export type TripSource = 'server' | 'mock';

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
  /** AI Trip Pipeline V2：创建时服务端 PREPROCESS 生成的结构化上下文；AI 不可用时缺省 */
  aiContext?: TripAIContext;
  /**
   * 服务器拥有的房间号；本地 Mock 仅提供固定开发值用于 Join 流程验收。
   * 前端禁止自行从 trip.id / userId / timestamp 伪造。
   */
  roomCode?: string;
  /** 数据来源标记：'mock' 表示内置示例行程，禁止任何后端读写（判断以固定 ID 为准，此字段用于 UI 展示） */
  source?: TripSource;
}
