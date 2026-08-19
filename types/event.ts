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

export interface PlanEvent {
  id: string;
  type: PlanEventType;
  title: string;
  time: TimeRange;
  location?: Location;
  price?: Price;
  restaurant?: Restaurant;
  /** 备选方案描述 */
  alternatives?: string[];
}