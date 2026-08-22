// services/route-option-service.ts
// 「我的推荐」路线方案服务：real 直连腾讯 direction v1，mock 返回 DEV FIXTURE。
// 失败语义：real 实现失败必须真实抛错（RouteOptionError），绝不回退假路线。

import { RouteOptionService, RoutePlanQuery, RoutePlanResult } from '../types/route-option';
import {
  RouteOptionError,
  TencentDirectionProvider,
  tencentDirectionProvider,
} from './providers/tencent-direction-provider';
import { MOCK_ROUTE_DESTINATION, mockRouteOptions } from '../mock/mock-route-options';

export { RouteOptionError };

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
    // DEV FIXTURE：mock 模式不消费 query 内容，固定返回演示路线（目的地为广州塔）
    return {
      options: mockRouteOptions,
      resolvedDestination: MOCK_ROUTE_DESTINATION,
    };
  }

  private static delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
