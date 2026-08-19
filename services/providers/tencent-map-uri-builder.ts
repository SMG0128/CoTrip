// services/providers/tencent-map-uri-builder.ts
// 腾讯地图 URI 构建器：运行时生成 search / routeplan / marker URI。
// 禁止在页面里散落写死 URL，统一从这里生成。
// 必须使用 encodeURIComponent 处理名称与参数。

import { tencentMapConfig } from '../../config/tencent-map';
import { Location } from '../../types/location';

export interface SearchUriParams {
  keyword: string;
  region?: string;
}

export interface RouteUriParams {
  /** 起点经纬度 */
  from?: { latitude: number; longitude: number };
  /** 终点经纬度 */
  to: { latitude: number; longitude: number };
  /** 交通方式：driving / walking / transit / bicycling */
  mode?: 'driving' | 'walking' | 'transit' | 'bicycling';
}

export interface MarkerUriParams {
  location: Location;
  title?: string;
}

export class TencentMapUriBuilder {
  private readonly base: string;
  private readonly referer: string;

  constructor(base = tencentMapConfig.uriBase, referer = tencentMapConfig.referer) {
    this.base = base;
    this.referer = referer;
  }

  /** 地点搜索 URI */
  buildSearchUri(params: SearchUriParams): string {
    const query = new URLSearchParams();
    query.set('keyword', params.keyword);
    query.set('region', params.region || tencentMapConfig.defaultCity);
    query.set('referer', this.referer);
    return `${this.base}search?${query.toString()}`;
  }

  /** 路线规划 URI */
  buildRouteUri(params: RouteUriParams): string {
    const query = new URLSearchParams();
    if (params.from) {
      query.set('from', `${params.from.latitude},${params.from.longitude}`);
    }
    query.set('to', `${params.to.latitude},${params.to.longitude}`);
    query.set('mode', params.mode || 'transit');
    query.set('referer', this.referer);
    return `${this.base}routeplan?${query.toString()}`;
  }

  /** 标记点 URI */
  buildMarkerUri(params: MarkerUriParams): string {
    const query = new URLSearchParams();
    query.set('marker', `coord:${params.location.latitude},${params.location.longitude};title:${params.title || params.location.name}`);
    query.set('referer', this.referer);
    return `${this.base}marker?${query.toString()}`;
  }
}

/** 单例 */
export const tencentMapUriBuilder = new TencentMapUriBuilder();