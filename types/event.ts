// types/event.ts
// 计划事件

import { TimeRange } from './time';
import { Location } from './location';
import { Price } from './price';
import { ProviderRef } from './location';
import { Restaurant } from './restaurant';

/** 真实路线段（腾讯 direction 返回，挂在被到达的活动上） */
export interface PlanEventRoute {
  fromEventId: string;
  durationMinutes: number;
  distanceMeters?: number;
  mode: 'transit' | 'walking' | 'driving';
  provider: 'tencent';
}

/** 服务端返回的真实餐厅候选（Provider 验证；字段形状与 event.restaurant 对齐） */
export interface RestaurantCandidate {
  id: string;
  name: string;
  location: Location;
  distanceMeters?: number;
  rating?: { score: number };
  averagePrice?: Price;
  providerRefs?: ProviderRef[];
}

export type PlanEventType =
  | 'SPORT'
  | 'DINING'
  | 'TRANSPORT'
  | 'ENTERTAINMENT'
  | 'OTHER';

/** 事件地点要求：由 Location Constraint 推导，结构化而非塞进 description */
export interface LocationRequirement {
  district?: string;
  city?: string;
  locationId?: string;
}

export interface PlanEvent {
  id: string;
  type: PlanEventType;
  title: string;
  time: TimeRange;
  location?: Location;
  /** 地点要求（结构化） */
  locationRequirement?: LocationRequirement;
  price?: Price;
  restaurant?: Restaurant;
  /** 附近搜索返回的全部真实餐厅候选（确定性排序后 top = restaurant） */
  restaurantCandidates?: RestaurantCandidate[];
  /** 相邻活动的真实路线段（腾讯 direction；仅真实返回时存在） */
  route?: PlanEventRoute;
  /** 备选方案描述 */
  alternatives?: string[];
}