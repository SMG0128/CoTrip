// 行程计划快照（Server 权威结构）。
//
// 设计约束（AI Trip Pipeline V2 · Stage 2）：
//   - 本类型刻意与小程序端 types/plan.ts 的 Plan / PlanEvent 结构保持一致，
//     使 INITIAL_GENERATION 产出的首版行程能够直接落到 Trip.currentPlan 并被现有页面渲染。
//     后端不 import 小程序 runtime 类型，因此这里是独立镜像，而不是第二套 itinerary schema。
//   - 产品不变量：AI 只产出「做什么 / 什么时候 / 地点要求」，绝不产出经过验证的真实世界事实。
//     因此本类型不含 location（带坐标的已验证地点）、price、restaurant —— 那些只能来自
//     Provider 适配层（腾讯地图等）。校验层会主动拒绝 AI 携带这些字段。

export type TripPlanEventType =
  | 'SPORT'
  | 'DINING'
  | 'TRANSPORT'
  | 'ENTERTAINMENT'
  | 'OTHER';

/** 时间必须是带时区的 ISO-8601 结构，禁止「下午三点」这类自然语言 */
export interface TripPlanTimeRange {
  start: string;
  end?: string;
  timezone: string;
}

/** 地点「要求」而非已验证地点：由用户表达的约束推导，交给 Provider 层去检索真实实体 */
export interface TripPlanLocationRequirement {
  city?: string;
  district?: string;
  locationId?: string;
}

export interface TripPlanEvent {
  id: string;
  type: TripPlanEventType;
  title: string;
  time: TripPlanTimeRange;
  locationRequirement?: TripPlanLocationRequirement;
  alternatives?: string[];
}

export interface TripPlan {
  id: string;
  tripId: string;
  version: number;
  events: TripPlanEvent[];
  /** AI 对本版行程的结构化概述（非页面文案，前端可自行决定是否展示） */
  summary?: string;
  satisfiedConstraintCount: number;
  totalConstraintCount: number;
  conflicts: never[];
  updatedAt: string;
}
