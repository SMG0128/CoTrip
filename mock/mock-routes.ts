// mock/mock-routes.ts
// Mock 个人路线数据

import { Route } from '../types/route';
import { mockHome, mockMetroStation, mockBadmintonVenue } from './mock-locations';

export const mockPersonalRoute: Route = {
  id: 'route_user_a',
  ownerId: 'user_A',
  from: mockHome,
  to: mockBadmintonVenue,
  departureTime: '2026-08-22T10:06:00+08:00',
  arrivalTime: '2026-08-22T10:57:00+08:00',
  durationMinutes: 51,
  transport: 'MIXED',
  estimatedPrice: { amount: 6, currency: 'CNY', unit: 'TOTAL' },
};

/** 路线分段（用于展示步行/地铁等步骤） */
export const mockRouteSegments = [
  { label: '当前位置', action: '步行 8 min', transport: 'WALK' as const },
  { label: '地铁站', action: '地铁 42 min', transport: 'METRO' as const },
  { label: '体育西路', action: '步行 6 min', transport: 'WALK' as const },
  { label: 'XX 羽毛球馆', action: '到达', transport: 'WALK' as const },
];

export { mockMetroStation };