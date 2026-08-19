// mock/mock-plan.ts
// Mock 计划数据

import { Plan } from '../types/plan';
import { mockBadmintonVenue, mockRestaurantLocation } from './mock-locations';
import { mockRestaurants } from './mock-restaurants';

export const mockPlan: Plan = {
  id: 'plan_active',
  tripId: 'trip_active',
  version: 3,
  events: [
    {
      id: 'event_badminton',
      type: 'SPORT',
      title: '羽毛球',
      time: { start: '2026-08-22T11:00:00+08:00', end: '2026-08-22T13:00:00+08:00', timezone: 'Asia/Shanghai' },
      location: mockBadmintonVenue,
      price: { amount: 28, currency: 'CNY', unit: 'PER_PERSON' },
    },
    {
      id: 'event_transport',
      type: 'TRANSPORT',
      title: '前往越秀',
      time: { start: '2026-08-22T13:00:00+08:00', end: '2026-08-22T13:40:00+08:00', timezone: 'Asia/Shanghai' },
    },
    {
      id: 'event_dining',
      type: 'DINING',
      title: '越南菜',
      time: { start: '2026-08-22T14:00:00+08:00', timezone: 'Asia/Shanghai' },
      location: mockRestaurantLocation,
      restaurant: mockRestaurants[0],
    },
  ],
  estimatedTotalPrice: { min: 75, max: 95, currency: 'CNY', unit: 'PER_PERSON' },
  satisfiedConstraintCount: 7,
  totalConstraintCount: 8,
  conflicts: [
    {
      id: 'conflict_001',
      description: 'D 希望总预算 ≤ ¥70，但当前最低可执行方案约为 ¥75。',
      constraintIds: ['constraint_budget_d'],
      suggestions: ['降低餐厅档次', '缩短活动时长', '更换更便宜的球馆'],
    },
  ],
  updatedAt: '2026-08-16T09:40:00+08:00',
};