// services/mock/mock-place-service.ts
// PlaceService 的 Mock 实现。

import { PlaceService } from '../place-service';
import { Location } from '../../types/location';
import { Restaurant } from '../../types/restaurant';
import { mockBadmintonVenue, mockRestaurantLocation } from '../../mock/mock-locations';
import { mockRestaurants } from '../../mock/mock-restaurants';

export class MockPlaceService implements PlaceService {
  async getLocation(locationId: string): Promise<Location | null> {
    const all = [mockBadmintonVenue, mockRestaurantLocation];
    return all.find((l) => l.id === locationId) ?? null;
  }

  async getRestaurant(restaurantId: string): Promise<Restaurant | null> {
    return mockRestaurants.find((r) => r.id === restaurantId) ?? null;
  }

  async listRecommendedRestaurants(tripId: string): Promise<Restaurant[]> {
    return mockRestaurants;
  }
}