// services/index.ts
// Service 统一入口。
// 认证服务：根据 config/auth.ts 的 mode 显式选择真实实现或 Mock。
// 其余服务当前使用 Mock 实现，未来切换真实后端时替换实例化即可。

import { AIService } from './ai-service';
import { TripService } from './trip-service';
import { MapService } from './map-service';
import { PlaceService } from './place-service';
import { NotificationService } from './notification-service';
import { ExternalActionService } from './external-action-service';
import { AuthService } from './auth-service';
import { RouteOptionService } from '../types/route-option';

import { MockAIService } from './mock/mock-ai-service';
import { MockTripService } from './mock/mock-trip-service';
import { MockMapService } from './mock/mock-map-service';
import { MockPlaceService } from './mock/mock-place-service';
import { MockNotificationService } from './mock/mock-notification-service';
import { MockExternalActionService } from './mock/mock-external-action-service';
import { MockAuthService } from './mock/mock-auth-service';
import { RealAuthService } from './real/real-auth-service';
import { RealTripService } from './real/real-trip-service';
import { MockRouteOptionService, RealRouteOptionService } from './route-option-service';

import { authConfig } from '../config/auth';

// 认证服务：按显式 mode 选择实现。real 模式下后端失败不会回退 Mock。
export const authService: AuthService =
  authConfig.mode === 'real' ? new RealAuthService() : new MockAuthService();

export const aiService: AIService = new MockAIService();
export const tripService: TripService =
  authConfig.mode === 'real' ? new RealTripService() : new MockTripService();
export const mapService: MapService = new MockMapService();
export const placeService: PlaceService = new MockPlaceService();
export const notificationService: NotificationService = new MockNotificationService();
export const externalActionService: ExternalActionService = new MockExternalActionService();

// 路线方案服务：「我的推荐」路线选择。real 模式直连腾讯地图，失败真实抛错不回退。
export const routeOptionService: RouteOptionService =
  authConfig.mode === 'real' ? new RealRouteOptionService() : new MockRouteOptionService();

export type {
  AIService,
  TripService,
  MapService,
  PlaceService,
  NotificationService,
  ExternalActionService,
  AuthService,
  RouteOptionService,
};
export type { TripJoinPreview } from './trip-service';
