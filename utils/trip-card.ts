// utils/trip-card.ts
// Trip Card 展示层纯函数：由真实 event 数据推导 UI 状态与图标。
// 禁止基于「这是 active card」做 Mock 语义假设（羽毛球/餐厅）。

import { PlanEvent, PlanEventType } from '../types/event';

export type TripCardState = 'EMPTY' | 'SINGLE_EVENT' | 'MULTI_EVENT';

export function deriveTripCardState(events: PlanEvent[]): TripCardState {
  if (events.length === 0) {
    return 'EMPTY';
  }
  if (events.length === 1) {
    return 'SINGLE_EVENT';
  }
  return 'MULTI_EVENT';
}

const EVENT_ICON_BY_TYPE: Record<PlanEventType, string> = {
  SPORT: '/assets/icons/trip/sport.svg',
  DINING: '/assets/icons/trip/food.svg',
  TRANSPORT: '/assets/icons/trip/transport.svg',
  ENTERTAINMENT: '/assets/icons/trip/entertainment.svg',
  OTHER: '/assets/icons/trip/generic-event.svg',
};

/** 按事件类型映射统一 UI 图标；未知/缺失类型一律回退到 generic-event。 */
export function resolveEventIcon(type: PlanEventType | undefined | null): string {
  if (type && type in EVENT_ICON_BY_TYPE) {
    return EVENT_ICON_BY_TYPE[type as PlanEventType];
  }
  return EVENT_ICON_BY_TYPE.OTHER;
}
