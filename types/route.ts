// types/route.ts
// 个人路线：由地图服务计算，不由 LLM 凭空生成。

import { Location } from './location';
import { Price } from './price';

export type TransportMode =
  | 'WALK'
  | 'METRO'
  | 'BUS'
  | 'TAXI'
  | 'DRIVE'
  | 'MIXED';

export interface Route {
  id: string;
  ownerId: string;
  from: Location;
  to: Location;
  departureTime?: string;
  arrivalTime?: string;
  durationMinutes?: number;
  transport: TransportMode;
  estimatedPrice?: Price;
}