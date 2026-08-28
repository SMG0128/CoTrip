// services/index.ts
// Service 统一入口。
// 登录与全部行程能力（列表/创建/详情/分享/Join/持久化）一律使用真实后端实现；
// 后端失败时明确暴露错误状态，绝不静默回退 Mock。
// Mock 仅剩一条内置示例行程（utils/demo-trip.ts），不经过本文件的服务契约。
// 路线规划已启用真实腾讯地图 Provider。
// AI / 地图 / 地点 / 通知 / 外部动作当前为既有能力实现，后续按需替换。

import { AIService } from './ai-service';
import { TripService } from './trip-service';
import { CommentService } from './comment-service';
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
import { RealCommentService } from './real/real-comment-service';
import { RealRouteOptionService } from './route-option-service';

// 认证：一律真实后端（wx.login → CoTrip Backend），后端不可用时登录明确失败。
export const authService: AuthService = new RealAuthService();

// 行程：一律真实后端，无全局 Mock 模式、无 Mock fallback。
export const tripService: TripService = new RealTripService();

// 评论流：一律真实后端（共享实体持久化，禁止本地 mock 假装多人评论已实现）。
export const commentService: CommentService = new RealCommentService();

export const aiService: AIService = new MockAIService();
export const mapService: MapService = new MockMapService();
export const placeService: PlaceService = new MockPlaceService();
export const notificationService: NotificationService = new MockNotificationService();
export const externalActionService: ExternalActionService = new MockExternalActionService();

// 路线方案服务：真实行程走腾讯地图 direction v1（已启用）。
// 调用前置条件由页面门禁（utils/personal-route.ts）保证：必须同时具备
// 个人出发地点与计划第一个地点，缺一不发请求。
// 未配置真实 Key 时 Provider 直接抛 NOT_CONFIGURED，UI 显示「暂未配置地图服务」，绝不伪造路线。
// 需要临时熔断时把这里换回 DisabledRouteOptionService 即可（无需改页面）。
export const routeOptionService: RouteOptionService = new RealRouteOptionService();

export type {
  AIService,
  TripService,
  CommentService,
  MapService,
  PlaceService,
  NotificationService,
  ExternalActionService,
  AuthService,
  RouteOptionService,
};
export type { TripJoinPreview } from './trip-service';
