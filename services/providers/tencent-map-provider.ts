// services/providers/tencent-map-provider.ts
// 腾讯位置服务 Provider：通过 wx.request 调用 WebService API。
// 返回结果必须经过 TencentMapAdapter 转换为 CoTrip Entity（Location / Restaurant），
// 禁止把腾讯 API Response 直接暴露给页面。

import { Location, ProviderRef } from '../../types/location';
import { Restaurant } from '../../types/restaurant';
import { Price } from '../../types/price';
import { tencentMapConfig, isTencentMapConfigured } from '../../config/tencent-map';

export interface PlaceSearchQuery {
  keyword: string;
  /** 区域边界，如 region(广州市, 0) */
  boundary?: string;
  city?: string;
  pageSize?: number;
}

export interface RestaurantSearchQuery {
  keyword: string;
  city?: string;
  pageSize?: number;
}

export interface PlaceProvider {
  searchPlaces(query: PlaceSearchQuery): Promise<Location[]>;
  searchRestaurants(query: RestaurantSearchQuery): Promise<Restaurant[]>;
}

// ---- 腾讯 API DTO（仅 Provider 内部使用） ----
interface TencentPlaceResult {
  status: number;
  message: string;
  data: TencentPlaceItem[];
}

interface TencentPlaceItem {
  id: string;
  title: string;
  address: string;
  category: string;
  type: number;
  location: {
    lat: number;
    lng: number;
  };
  _distance?: number;
  tel?: string;
}

/** 腾讯 API 响应 → CoTrip Entity 的适配器 */
export class TencentMapAdapter {
  /** 转换单个 POI 为 Location */
  toLocation(item: TencentPlaceItem, provider: string): Location {
    const district = this.extractDistrict(item.address);
    return {
      id: `location_${item.id}`,
      name: item.title,
      latitude: item.location.lat,
      longitude: item.location.lng,
      address: item.address,
      district,
      city: tencentMapConfig.defaultCity,
      providerRefs: [{ provider, externalId: item.id }],
    };
  }

  /** 转换 POI 为 Restaurant（价格/评分由其他来源补充，这里不伪造） */
  toRestaurant(item: TencentPlaceItem, provider: string): Restaurant {
    const location = this.toLocation(item, provider);
    return {
      id: `restaurant_${item.id}`,
      name: item.title,
      location,
      categories: this.extractCategories(item.category),
      externalActions: [],
    };
  }

  /** 从地址提取区名（优先匹配已知行政区，避免误匹配"州市区"） */
  private extractDistrict(address: string): string | undefined {
    const knownDistricts = [
      '越秀区', '天河区', '海珠区', '荔湾区', '白云区', '黄埔区',
      '番禺区', '花都区', '南沙区', '从化区', '增城区',
    ];
    for (const d of knownDistricts) {
      if (address.includes(d)) return d;
    }
    // 兜底：匹配"XX区"（2 字区名）
    const m = address.match(/([\u4e00-\u9fa5]{2}区)/);
    return m ? m[1] : undefined;
  }

  /** 从分类提取餐厅类别 */
  private extractCategories(category: string): string[] {
    const lower = category.toLowerCase();
    if (lower.includes('越南')) return ['VIETNAMESE'];
    if (lower.includes('餐厅') || lower.includes('美食')) return ['DINING'];
    return ['OTHER'];
  }
}

export class TencentMapProvider implements PlaceProvider {
  private readonly adapter = new TencentMapAdapter();
  private readonly providerName = 'tencent_map';

  /** 是否可调用真实 API */
  get isConfigured(): boolean {
    return isTencentMapConfigured();
  }

  async searchPlaces(query: PlaceSearchQuery): Promise<Location[]> {
    if (!this.isConfigured) {
      throw new Error('TencentMapProvider 未配置 Key，无法调用真实 API');
    }
    const boundary = query.boundary || `region(${query.city || tencentMapConfig.defaultCity}, 0)`;
    const data = await this.request({
      keyword: query.keyword,
      boundary,
      page_size: query.pageSize || 10,
    });
    return data.map((item) => this.adapter.toLocation(item, this.providerName));
  }

  async searchRestaurants(query: RestaurantSearchQuery): Promise<Restaurant[]> {
    if (!this.isConfigured) {
      throw new Error('TencentMapProvider 未配置 Key，无法调用真实 API');
    }
    const boundary = `region(${query.city || tencentMapConfig.defaultCity}, 0)`;
    const data = await this.request({
      keyword: query.keyword,
      boundary,
      page_size: query.pageSize || 10,
    });
    return data.map((item) => this.adapter.toRestaurant(item, this.providerName));
  }

  /** 调用腾讯地点搜索 API */
  private request(params: Record<string, string | number>): Promise<TencentPlaceItem[]> {
    return new Promise((resolve, reject) => {
      const query: Record<string, string | number> = {
        key: tencentMapConfig.key,
        ...params,
      };
      wx.request({
        url: tencentMapConfig.placeSearchUrl,
        data: query,
        method: 'GET',
        success: (res) => {
          const body = res.data as TencentPlaceResult;
          if (body && body.status === 0 && Array.isArray(body.data)) {
            resolve(body.data);
          } else {
            reject(new Error(`腾讯地图 API 返回异常: ${body?.message || '未知错误'}`));
          }
        },
        fail: (err) => reject(new Error(`腾讯地图 API 请求失败: ${err.errMsg}`)),
      });
    });
  }
}

/** 单例 */
export const tencentMapProvider = new TencentMapProvider();