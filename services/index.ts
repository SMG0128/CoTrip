// services/index.ts
// Service 统一入口。
// 登录与全部行程能力（列表/创建/详情/分享/Join/持久化）一律使用真实后端实现；
// 后端失败时明确暴露错误状态，绝不静默回退 Mock。
// Mock 仅剩一条内置示例行程（utils/demo-trip.ts），不经过本文件的服务契约。
// AI / 地图 / 地点 / 通知 / 外部动作当前为既有能力实现，后续按需替换。

import { AIService } from './ai-service';
import { TripService } from './trip-service';
import { MapService } from './map-service';
import { PlaceService } from './place-service';
import { NotificationService } from './notification-service';
import { ExternalActionService } from './external-action-service';
import { AuthService } from './auth-service';
import { RouteOptionService } from '../types/route-option';

import { MockAIService } from './mock/mock-ai-service';
import { MockMapService } from './mock/mock-map-service';
import { MockPlaceService } from './mock/mock-place-service';
import { MockNotificationService } from './mock/mock-notification-service';
import { MockExternalActionService } from './mock/mock-external-action-service';
import { RealAuthService } from './real/real-auth-service';
import { RealTripService } from './real/real-trip-service';
import { DisabledRouteOptionService } from './route-option-service';

// 认证：一律真实后端（wx.login → CoTrip Backend），后端不可用时登录明确失败。
export const authService: AuthService = new RealAuthService();

// 行程：一律真实后端，无全局 Mock 模式、无 Mock fallback。
export const tripService: TripService = new RealTripService();

export const aiService: AIService = new MockAIService();
export const mapService: MapService = new MockMapService();
export const placeService: PlaceService = new MockPlaceService();
export const notificationService: NotificationService = new MockNotificationService();
export const externalActionService: ExternalActionService = new MockExternalActionService();

// 路线方案服务：真实行程暂时全局禁用，保证不会误触腾讯 API；
// 示例行程由页面显式使用 MockRouteOptionService 读取已固化路线。
export const routeOptionService: RouteOptionService = new DisabledRouteOptionService();

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
