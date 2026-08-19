// services/place-service.ts
// 地点服务接口：负责球馆、餐厅、地点详情、第三方 Provider。

import { Location } from '../types/location';
import { Restaurant } from '../types/restaurant';
import { Constraint } from '../types/constraint';

export interface PlaceService {
  getLocation(locationId: string): Promise<Location | null>;
  getRestaurant(restaurantId: string): Promise<Restaurant | null>;
  listRecommendedRestaurants(tripId: string): Promise<Restaurant[]>;
  /** 根据约束对餐厅候选排序（Planner Ranking） */
  rankRestaurants(constraints: Constraint[]): Promise<Restaurant[]>;
  /** 搜索地点：优先真实 Provider，失败回退 Seed */
  searchPlaces(keyword: string, city?: string): Promise<Location[]>;
}