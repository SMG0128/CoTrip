// mock/mock-plan.ts
// Mock 计划数据（V0.3 真实地点 Demo）
// 11:30 - 13:30 羽毛球（天河）→ 交通 → 14:30 越南菜（越秀）

import { Plan } from '../types/plan';
import { mockBadmintonVenue } from './mock-locations';
import { realRestaurantCailan } from './mock-real-places';

export const mockPlan: Plan = {
  id: 'plan_active',
  tripId: 'trip_active',
  version: 3,
  events: [
    {
      id: 'event_badminton',
      type: 'SPORT',
      title: '羽毛球',
      time: { start: '2026-08-22T11:30:00+08:00', end: '2026-08-22T13:30:00+08:00', timezone: 'Asia/Shanghai' },
      location: mockBadmintonVenue,
      price: { amount: 28, currency: 'CNY', unit: 'PER_PERSON' },
    },
    {
      id: 'event_transport',
      type: 'TRANSPORT',
      title: '前往越秀',
      time: { start: '2026-08-22T13:30:00+08:00', end: '2026-08-22T14:10:00+08:00', timezone: 'Asia/Shanghai' },
    },
    {
      id: 'event_dining',
      type: 'DINING',
      title: '越南菜',
      time: { start: '2026-08-22T14:30:00+08:00', timezone: 'Asia/Shanghai' },
      location: realRestaurantCailan.location,
      restaurant: realRestaurantCailan,
    },
  ],
  estimatedTotalPrice: { min: 75, max: 95, currency: 'CNY', unit: 'PER_PERSON' },
  satisfiedConstraintCount: 7,
  totalConstraintCount: 8,
  conflicts: [],
  updatedAt: '2026-08-16T09:40:00+08:00',
};