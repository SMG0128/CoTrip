// services/route-option-service.ts
// 「我的推荐」路线方案服务：disabled 阻断真实请求，mock 返回固化 fixture，
// real 实现保留供后续恢复腾讯 direction v1；所有失败都真实抛错，绝不隐式 fallback。

import { RouteOptionService, RoutePlanQuery, RoutePlanResult } from '../types/route-option';
import {
  RouteOptionError,
  TencentDirectionProvider,
  tencentDirectionProvider,
} from './providers/tencent-direction-provider';
import { MOCK_ROUTE_DESTINATION, mockRouteOptions } from '../mock/mock-route-options';

export { RouteOptionError };

/** 临时产品门禁：真实行程不得调用腾讯路线 API。 */
export const ROUTE_OPTION_DISABLED_MESSAGE = '路线规划暂仅供示例行程预览';

/** 全局禁用实现：始终在 Provider 调用前失败，防止任何真实行程误触腾讯 API。 */
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

/** Mock 实现：返回手工 fixture（约 300ms 延迟模拟加载），仅供 mock 模式开发预览 */
export class MockRouteOptionService implements RouteOptionService {
  async planRoutes(_query: RoutePlanQuery): Promise<RoutePlanResult> {
    await MockRouteOptionService.delay(300);
    // DEV FIXTURE：不消费 query 内容，固定返回已固化的广州羽毛球中心路线。
    return {
      options: mockRouteOptions,
      resolvedDestination: MOCK_ROUTE_DESTINATION,
    };
  }

  private static delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
