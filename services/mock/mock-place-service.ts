// services/mock/mock-place-service.ts
// PlaceService 实现：优先走真实 Provider，失败时回退到真实 Seed。

import { PlaceService } from '../place-service';
import { Location } from '../../types/location';
import { Restaurant } from '../../types/restaurant';
import { realLocations, realRestaurants } from '../../mock/mock-real-places';
import { tencentMapProvider } from '../providers/tencent-map-provider';
import { rankCandidates } from '../../core/candidate-ranker';
import { Constraint } from '../../types/constraint';

export class MockPlaceService implements PlaceService {
  async getLocation(locationId: string): Promise<Location | null> {
    return realLocations.find((l) => l.id === locationId) ?? null;
  }

  async getRestaurant(restaurantId: string): Promise<Restaurant | null> {
    return realRestaurants.find((r) => r.id === restaurantId) ?? null;
  }

  async listRecommendedRestaurants(tripId: string): Promise<Restaurant[]> {
    return realRestaurants;
  }

  /** 根据约束对真实餐厅候选排序（Planner Ranking） */
  async rankRestaurants(constraints: Constraint[]): Promise<Restaurant[]> {
    const ranked = rankCandidates({ restaurants: realRestaurants, constraints });
    return ranked.map((r) => r.restaurant);
  }

  /** 搜索地点：优先真实 Provider，失败回退 Seed */
  async searchPlaces(keyword: string, city?: string): Promise<Location[]> {
    try {
      if (tencentMapProvider.isConfigured) {
        return await tencentMapProvider.searchPlaces({ keyword, city });
      }
    } catch (e) {
      console.warn('[PlaceService] Provider 搜索失败，回退 Seed', e);
    }
    // Seed Fallback：按名称模糊匹配
    return realLocations.filter((l) => l.name.includes(keyword));
  }
}