// tencent-direction-service.ts
// 腾讯路线规划（direction v1）服务端封装。
//
// 复用项目已有 Tencent direction 请求/响应归一化契约（services/providers/tencent-direction-provider.ts）：
//   - 同一 endpoint：ws/direction/v1/{mode}/，from/to 均为 lat,lng
//   - 同一响应模型：{ status: 0, result: { routes: [{ duration, distance }] } }
//     duration 单位=分钟、distance 单位=米（与前端解析一致）
//   - 同一 mode 集合：transit / walking / driving
//
// Server 使用自己的 process.env.TENCENT_MAP_KEY，绝不读取前端 config、绝不硬编码、
// 绝不打印 Key。方向 API 不可用时返回 DIRECTION_UNAVAILABLE，绝不伪造 duration。
//
// 产品不变量（J/K 节）：
//   - 只有腾讯真实返回的 duration / distance 才会被使用。
//   - status !== 0 / 无 routes / duration 非有限正数 → 一律视为不可用。
//   - 本模块不建立第二套 route domain model；输出即前端 Route 的 provider 数据源。

export type TencentDirectionMode = 'transit' | 'walking' | 'driving';

/** 真实路线段（server 排程用最小契约，字段与前端 Route 对齐） */
export interface TencentRouteResult {
  durationMinutes: number;
  distanceMeters?: number;
  mode: TencentDirectionMode;
  provider: 'tencent';
}

export type DirectionOutcome =
  | { status: 'FOUND'; route: TencentRouteResult }
  | { status: 'DIRECTION_UNAVAILABLE' };

export interface TencentDirectionOptions {
  key: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: (url: string, init: { signal: AbortSignal }) => Promise<{
    ok: boolean;
    json(): Promise<unknown>;
  }>;
}

interface TencentDirectionRouteItem {
  duration?: number;
  distance?: number;
}

interface TencentDirectionResponse {
  status: number;
  message?: string;
  result?: {
    routes?: TencentDirectionRouteItem[];
  };
}

export class TencentDirectionService {
  private readonly key: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: TencentDirectionOptions['fetchImpl'];

  constructor(options: TencentDirectionOptions) {
    this.key = options.key;
    this.baseUrl = options.baseUrl ?? 'https://apis.map.qq.com/ws/direction/v1/';
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  /** 是否已配置真实 Key（未配置时一律返回 DIRECTION_UNAVAILABLE，绝不伪造） */
  get isConfigured(): boolean {
    return typeof this.key === 'string' && this.key.length > 0;
  }

  /**
   * 获取两点间真实路线。
   * from / to 均为已解析的腾讯真实坐标（latitude, longitude）。
   *
   * 返回值 truth-preserving：只有腾讯真实返回的 duration / distance 会被使用；
   * 任何异常 / 状态码非 0 / duration 非有限正数 → DIRECTION_UNAVAILABLE。
   */
  async getDirection(
    from: { latitude: number; longitude: number },
    to: { latitude: number; longitude: number },
    mode: TencentDirectionMode = 'transit',
  ): Promise<DirectionOutcome> {
    if (!this.isConfigured) return { status: 'DIRECTION_UNAVAILABLE' };
    if (
      !Number.isFinite(from.latitude) ||
      !Number.isFinite(from.longitude) ||
      !Number.isFinite(to.latitude) ||
      !Number.isFinite(to.longitude)
    ) {
      return { status: 'DIRECTION_UNAVAILABLE' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const query = new URLSearchParams();
      query.set('key', this.key);
      query.set('from', `${from.latitude},${from.longitude}`);
      query.set('to', `${to.latitude},${to.longitude}`);
      const url = `${this.baseUrl}${mode}/?${query.toString()}`;
      const response = await this.fetchImpl!(url, { signal: controller.signal });
      if (!response.ok) return { status: 'DIRECTION_UNAVAILABLE' };
      const body = (await response.json()) as TencentDirectionResponse;
      if (body.status !== 0 || !body.result || !Array.isArray(body.result.routes)) {
        return { status: 'DIRECTION_UNAVAILABLE' };
      }
      const first = body.result.routes[0];
      if (!first) return { status: 'DIRECTION_UNAVAILABLE' };
      const durationMinutes = first.duration;
      if (typeof durationMinutes !== 'number' || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
        return { status: 'DIRECTION_UNAVAILABLE' };
      }
      const route: TencentRouteResult = {
        durationMinutes: Math.round(durationMinutes),
        mode,
        provider: 'tencent',
      };
      if (typeof first.distance === 'number' && Number.isFinite(first.distance) && first.distance > 0) {
        route.distanceMeters = Math.round(first.distance);
      }
      return { status: 'FOUND', route };
    } catch {
      return { status: 'DIRECTION_UNAVAILABLE' };
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * 把用户明确指定的交通偏好映射为 direction mode。
 * 未指定时返回 undefined，由调用方比较 walking / transit 的真实路线时长。
 * 不做复杂交通策略：只做 步行/地铁公交/打车 三类常见映射。
 */
export function resolveDirectionMode(preference?: string): TencentDirectionMode | undefined {
  if (!preference) return undefined;
  if (/步行|走路|走走/.test(preference)) return 'walking';
  if (/地铁|公交|乘地铁|坐地铁|公交车|公共交通|公交地铁/.test(preference)) return 'transit';
  if (/打车|驾车|开车|自驾|出租车/.test(preference)) return 'driving';
  return undefined;
}
