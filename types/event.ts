// types/event.ts
// 计划事件

import { TimeRange } from './time';
import { Location } from './location';
import { Price } from './price';
import { Restaurant } from './restaurant';

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
  /** 备选方案描述 */
  alternatives?: string[];
}