// mock/mock-trip.ts
// Mock 行程数据

import { Trip } from '../types/trip';
import { mockPlan } from './mock-plan';
import { mockComments } from './mock-comments';

export const mockActiveTrip: Trip = {
  id: 'trip_active',
  title: '周六羽毛球 + 越南菜',
  status: 'ACTIVE',
  creatorId: 'user_A',
  participantIds: ['user_A', 'user_B', 'user_C', 'user_D'],
  createdAt: '2026-08-16T08:30:00+08:00',
  initialBrief: '打两个小时羽毛球，然后去吃越南菜。',
  areaConstraint: { district: '天河区', city: '广州市' },
  timeRange: { start: '2026-08-22T10:00:00+08:00', timezone: 'Asia/Shanghai' },
  currentPlan: mockPlan,
  commentIds: mockComments.map((c) => c.id),
  constraintIds: ['constraint_time_b', 'constraint_loc_c', 'constraint_budget_d'],
};

export const mockHistoryTrip: Trip = {
  id: 'trip_history',
  title: '羽毛球 + 越南菜',
  status: 'COMPLETED',
  creatorId: 'user_A',
  participantIds: ['user_A', 'user_B', 'user_C', 'user_D'],
  createdAt: '2026-08-16T09:42:00+08:00',
  completedAt: '2026-08-16T17:18:00+08:00',
  initialBrief: '打羽毛球然后吃越南菜。',
  currentPlan: mockPlan,
  commentIds: mockComments.map((c) => c.id),
  constraintIds: ['constraint_time_b', 'constraint_loc_c', 'constraint_budget_d'],
};