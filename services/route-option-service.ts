// services/route-option-service.ts
// 「我的推荐」路线方案服务：real 走腾讯 direction v1（当前 services/index.ts 的正式接线），
// mock 返回固化 fixture 供内置示例行程开箱即用，disabled 保留为显式熔断开关；
// 所有失败都真实抛错，绝不隐式 fallback。

import { RouteOptionService, RoutePlanQuery, RoutePlanResult } from '../types/route-option';
import {
  RouteOptionError,
  TencentDirectionProvider,
  tencentDirectionProvider,
} from './providers/tencent-direction-provider';
import { MOCK_ROUTE_DESTINATION, mockRouteOptions } from '../mock/mock-route-options';

export { RouteOptionError };

/** 熔断态文案：仅当把 services/index.ts 换回 DisabledRouteOptionService 时才会出现。 */
export const ROUTE_OPTION_DISABLED_MESSAGE = '路线规划暂仅供示例行程预览';

/** 熔断实现：始终在 Provider 调用前失败，用于需要临时切断腾讯 API 的场景。 */
export class DisabledRouteOptionService implements RouteOptionService {
  async planRoutes(_query: RoutePlanQuery): Promise<RoutePlanResult> {
    throw new RouteOptionError('PROVIDER_ERROR', ROUTE_OPTION_DISABLED_MESSAGE);
  }
}

/** 真实实现：腾讯地图路线规划。provider 可注入以便测试 */
export class RealRouteOptionService implements RouteOptionService {
  constructor(private readonly provider: TencentDirectionProvider = tencentDirectionProvider) {}

  planRoutes(query: RoutePlanQuery): Promise<RoutePlanResult> {
    return this.provider.plan(query);
  }
}

/** Mock 实现：返回手工 fixture（约 300ms 延迟模拟加载），供内置示例行程开箱即用 */
export class MockRouteOptionService implements RouteOptionService {
  async planRoutes(_query: RoutePlanQuery): Promise<RoutePlanResult> {
    await MockRouteOptionService.delay(300);
    // DEV FIXTURE：不消费 query 内容，固定返回已固化的广州羽毛球中心路线。
    // 示例行程正因此不需要用户的出发地点，也不会触达任何腾讯 API。
    return {
      options: mockRouteOptions,
      resolvedDestination: MOCK_ROUTE_DESTINATION,
    };
  }

  private static delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
