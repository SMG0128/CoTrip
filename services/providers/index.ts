// services/providers/index.ts
// Provider 层统一出口

export { TencentMapProvider, TencentMapAdapter } from './tencent-map-provider';
export type { PlaceProvider, PlaceSearchQuery, RestaurantSearchQuery } from './tencent-map-provider';
export { tencentMapProvider } from './tencent-map-provider';
export { TencentMapUriBuilder, tencentMapUriBuilder } from './tencent-map-uri-builder';
export { ExternalActionResolver, externalActionResolver } from './external-action-resolver';