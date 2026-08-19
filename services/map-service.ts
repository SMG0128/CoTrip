// services/map-service.ts
// 地图服务接口：未来负责 POI 搜索、地址解析、路线规划、打开地图。
// 当前仅 Mock，不接腾讯地图正式接口。

import { Location } from '../types/location';
import { Route } from '../types/route';

export interface SearchPOIInput {
  keyword: string;
  district?: string;
  city?: string;
}

export interface PlanRouteInput {
  ownerId: string;
  from: Location;
  to: Location;
}

export interface MapService {
  searchPOI(input: SearchPOIInput): Promise<Location[]>;
  planRoute(input: PlanRouteInput): Promise<Route>;
  openLocation(location: Location): Promise<void>;
}