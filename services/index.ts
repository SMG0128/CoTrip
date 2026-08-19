// services/index.ts
// Service 统一入口：当前全部使用 Mock 实现。
// 未来切换真实后端时，只需替换这里的实例化。

import { AIService } from './ai-service';
import { TripService } from './trip-service';
import { MapService } from './map-service';
import { PlaceService } from './place-service';
import { NotificationService } from './notification-service';
import { ExternalActionService } from './external-action-service';

import { MockAIService } from './mock/mock-ai-service';
import { MockTripService } from './mock/mock-trip-service';
import { MockMapService } from './mock/mock-map-service';
import { MockPlaceService } from './mock/mock-place-service';
import { MockNotificationService } from './mock/mock-notification-service';
import { MockExternalActionService } from './mock/mock-external-action-service';

export const aiService: AIService = new MockAIService();
export const tripService: TripService = new MockTripService();
export const mapService: MapService = new MockMapService();
export const placeService: PlaceService = new MockPlaceService();
export const notificationService: NotificationService = new MockNotificationService();
export const externalActionService: ExternalActionService = new MockExternalActionService();

export type {
  AIService,
  TripService,
  MapService,
  PlaceService,
  NotificationService,
  ExternalActionService,
};