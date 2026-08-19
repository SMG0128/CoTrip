// services/place-service.ts
// 地点服务接口：未来负责球馆、餐厅、地点详情、第三方 Provider。
// 当前仅 Mock。

import { Location } from '../types/location';
import { Restaurant } from '../types/restaurant';

export interface PlaceService {
  getLocation(locationId: string): Promise<Location | null>;
  getRestaurant(restaurantId: string): Promise<Restaurant | null>;
  listRecommendedRestaurants(tripId: string): Promise<Restaurant[]>;
}