// services/mock/mock-map-service.ts
// MapService 的 Mock 实现：不接腾讯地图正式接口。

import { MapService, SearchPOIInput, PlanRouteInput } from '../map-service';
import { Location } from '../../types/location';
import { Route } from '../../types/route';
import { mockBadmintonVenue } from '../../mock/mock-locations';
import { mockPersonalRoute } from '../../mock/mock-routes';

export class MockMapService implements MapService {
  async searchPOI(input: SearchPOIInput): Promise<Location[]> {
    // Mock：返回固定球馆
    return [mockBadmintonVenue];
  }

  async planRoute(input: PlanRouteInput): Promise<Route> {
    // Mock：返回固定个人路线
    return { ...mockPersonalRoute, from: input.from, to: input.to };
  }

  async openLocation(location: Location): Promise<void> {
    // Mock：仅提示
    console.log('[MockMapService] openLocation', location.name);
  }
}