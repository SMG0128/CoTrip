// tencent-lbs-service.ts
// 腾讯位置服务（Tencent LBS）服务端封装。
//
// 复用项目已有的腾讯位置服务能力（ws/place/v1/search），不引入大众点评 / 美团 / 新 Provider。
// Key 从环境变量 TENCENT_MAP_KEY 读取（与前端 config/tencent-map.ts 是同一个腾讯 Key，
// 只是服务端通过 env 注入，绝不硬编码、绝不打印、绝不写入源码/测试 fixture）。
//
// 产品不变量（G/H/I 节）：
//   - truth-preserving：腾讯 API 实际没返回的字段一律 undefined，绝不补齐 rating/avgPrice/photo。
//   - 候选必须全部来自腾讯 API response，LLM 不得创造候选。
//   - 搜索失败绝不回退 mock / hardcoded / AI 生成的餐厅名。
//
// 腾讯 nearby 坐标顺序：latitude, longitude（不要写反）。

import {
  enrichTencentLocationAddress,
  ResolvedPhysicalLocation,
} from './resolved-physical-location';

/** 统一 PlaceCandidate：truth-preserving，腾讯未返回的字段保持 undefined */
export interface PlaceCandidate extends ResolvedPhysicalLocation {
  /** 距锚点距离（米）；腾讯 API 未返回时为 undefined */
  distanceMeters?: number;
  /** 分类；腾讯 API 未返回时为 undefined */
  category?: string;
  /** 电话；腾讯 API 未返回时为 undefined */
  telephone?: string;
  /** 评分；腾讯 API 未返回时为 undefined（禁止伪造） */
  rating?: number;
  /** 人均；腾讯 API 未返回时为 undefined（禁止伪造） */
  avgPrice?: number;
  /** 营业时间；腾讯 API 未返回时为 undefined */
  openingHours?: string;
  /** 照片；腾讯 API 未返回时为 undefined（禁止随机 URL） */
  photo?: string;
}

export type POISearchOutcome =
  | { status: 'FOUND'; candidates: PlaceCandidate[] }
  | { status: 'POI_NOT_FOUND'; candidates: [] }
  | { status: 'POI_SEARCH_UNAVAILABLE'; candidates: [] };

interface TencentPlaceItem {
  id: string;
  title: string;
  address?: string;
  category?: string;
  tel?: string;
  location: { lat: number; lng: number };
  _distance?: number;
}

interface TencentPlaceResponse {
  status: number;
  message?: string;
  data?: TencentPlaceItem[];
}

interface TencentReverseGeocodeResponse {
  status: number;
  result?: {
    address?: string;
    formatted_addresses?: {
      recommend?: string;
      rough?: string;
    };
  };
}

export interface TencentLBSOptions {
  key: string;
  baseUrl?: string;
  reverseGeocodeBaseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: (url: string, init: { signal: AbortSignal }) => Promise<{
    ok: boolean;
    json(): Promise<unknown>;
  }>;
}

export class TencentLBSService {
  private readonly key: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly reverseGeocodeBaseUrl: string;
  private readonly fetchImpl: TencentLBSOptions['fetchImpl'];

  constructor(options: TencentLBSOptions) {
    this.key = options.key;
    this.baseUrl = options.baseUrl ?? 'https://apis.map.qq.com/ws/place/v1/search';
    this.reverseGeocodeBaseUrl = options.reverseGeocodeBaseUrl
      ?? 'https://apis.map.qq.com/ws/geocoder/v1/';
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  /** 是否已配置真实 Key（未配置时搜索一律返回 POI_SEARCH_UNAVAILABLE，绝不伪造） */
  get isConfigured(): boolean {
    return typeof this.key === 'string' && this.key.length > 0;
  }

  /**
   * 按关键词 + 城市搜索 POI（region boundary）。
   * 用于把「广图 / 广州图书馆」解析为真实腾讯 POI。
   */
  async searchPOI(keyword: string, city: string): Promise<POISearchOutcome> {
    if (!this.isConfigured) return { status: 'POI_SEARCH_UNAVAILABLE', candidates: [] };
    const boundary = `region(${city}, 0)`;
    try {
      const items = await this.request({ keyword, boundary, page_size: 5 });
      if (items.length === 0) return { status: 'POI_NOT_FOUND', candidates: [] };
      return { status: 'FOUND', candidates: await this.toAddressCompleteCandidates(items) };
    } catch {
      return { status: 'POI_SEARCH_UNAVAILABLE', candidates: [] };
    }
  }

  /**
   * 以锚点坐标为中心搜索附近 POI（boundary=nearby）。
   * 腾讯 nearby 坐标顺序：latitude, longitude。
   */
  async searchNearby(
    keyword: string,
    latitude: number,
    longitude: number,
    radiusMeters = 3000,
  ): Promise<POISearchOutcome> {
    if (!this.isConfigured) return { status: 'POI_SEARCH_UNAVAILABLE', candidates: [] };
    const boundary = `nearby(${latitude},${longitude},${radiusMeters})`;
    try {
      const items = await this.request({ keyword, boundary, page_size: 10 });
      if (items.length === 0) return { status: 'POI_NOT_FOUND', candidates: [] };
      return { status: 'FOUND', candidates: await this.toAddressCompleteCandidates(items) };
    } catch {
      return { status: 'POI_SEARCH_UNAVAILABLE', candidates: [] };
    }
  }

  /** 腾讯 API 响应 → truth-preserving PlaceCandidate（只保留腾讯实际返回的字段） */
  private toCandidate(item: TencentPlaceItem): PlaceCandidate {
    const candidate: PlaceCandidate = {
      provider: 'tencent',
      providerPoiId: item.id,
      name: item.title,
      latitude: item.location.lat,
      longitude: item.location.lng,
    };
    if (item.address) candidate.address = item.address;
    if (item.category) candidate.category = item.category;
    if (item.tel) candidate.telephone = item.tel;
    if (typeof item._distance === 'number') candidate.distanceMeters = item._distance;
    // 腾讯 place/v1/search 不返回 rating / avgPrice / openingHours / photo，
    // 因此这些字段保持 undefined —— 绝不伪造。
    return candidate;
  }

  /** POI search 与 nearby search 共用同一地址补全管线。 */
  private async toAddressCompleteCandidates(items: TencentPlaceItem[]): Promise<PlaceCandidate[]> {
    return Promise.all(
      items.map((item) =>
        enrichTencentLocationAddress(
          this.toCandidate(item),
          (latitude, longitude) => this.reverseGeocodeAddress(latitude, longitude),
        ),
      ),
    );
  }

  /**
   * 同一 Tencent Provider 的逆地理编码。只返回腾讯响应中的真实地址；
   * 不记录 URL、不暴露 key，失败由调用方降级为 address undefined。
   */
  private async reverseGeocodeAddress(
    latitude: number,
    longitude: number,
  ): Promise<string | undefined> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const query = new URLSearchParams();
      query.set('key', this.key);
      query.set('location', `${latitude},${longitude}`);
      const response = await this.fetchImpl!(`${this.reverseGeocodeBaseUrl}?${query.toString()}`, {
        signal: controller.signal,
      });
      if (!response.ok) return undefined;
      const body = (await response.json()) as TencentReverseGeocodeResponse;
      if (body.status !== 0 || !body.result) return undefined;
      const address = [
        body.result.address,
        body.result.formatted_addresses?.recommend,
        body.result.formatted_addresses?.rough,
      ].find((value) => typeof value === 'string' && value.trim().length > 0);
      return typeof address === 'string' ? address.trim() : undefined;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async request(params: Record<string, string | number>): Promise<TencentPlaceItem[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const query = new URLSearchParams();
      query.set('key', this.key);
      for (const [k, v] of Object.entries(params)) query.set(k, String(v));
      const response = await this.fetchImpl!(`${this.baseUrl}?${query.toString()}`, {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('TENCENT_LBS_HTTP_ERROR');
      const body = (await response.json()) as TencentPlaceResponse;
      if (body.status !== 0 || !Array.isArray(body.data)) {
        throw new Error(`TENCENT_LBS_API_ERROR:${body.status ?? 'unknown'}`);
      }
      return body.data;
    } finally {
      clearTimeout(timeout);
    }
  }
}
