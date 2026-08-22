// services/providers/tencent-direction-provider.ts
// 腾讯路线规划 Provider：direction v1（步行 / 公交地铁）→ RouteOption[]。
// 边界：腾讯原始响应只在本文件内消化，经 TencentDirectionAdapter 防御式映射为
// types/route-option.ts 的 ViewModel，禁止把原始 DTO 暴露给页面。
// 失败语义：网络层失败 → NETWORK_ERROR；API/解析异常 → PROVIDER_ERROR；
// 绝不伪造兜底路线（产品不变量 8：优雅降级 ≠ 编造数据）。

import { RouteOption, RouteOptionErrorCode, RoutePlanQuery, RoutePlanResult, RouteStep, RouteTransportMode, ResolvedDestination } from '../../types/route-option';
import { tencentMapConfig, isTencentMapConfigured } from '../../config/tencent-map';
import { tencentMapProvider } from './tencent-map-provider';

/** 路线方案错误：UI 按 code 映射失败态，绝不静默回退假数据 */
export class RouteOptionError extends Error {
  constructor(
    public readonly code: RouteOptionErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'RouteOptionError';
  }
}

/** 单次规划返回给 UI 的最大方案数 */
export const MAX_ROUTE_OPTIONS = 3;
/** 时长差小于该值且交通方式完全相同 → 视为近似重复 */
export const NEAR_DUPLICATE_THRESHOLD_MINUTES = 3;
/** 单条步行路线时间轴节点上限（防御超长 steps 撑爆 UI） */
const MAX_WALKING_STEPS = 12;

/**
 * top-N 选择：保持 provider 排序（第一条即推荐），剔除近似重复项。
 * 规则：
 * - 与已保留任一选项「modes 完全相同 且 |时长差| < 3 分钟」→ 判定为近似重复，跳过；
 * - 最多保留 max 条，不足不补；输入顺序即输出顺序；
 * - 输出的 recommended 标记被归一化：index 0 → true，其余 false。
 * 独立纯函数以便单测覆盖。
 */
export function selectTopRouteOptions(all: RouteOption[], max: number = MAX_ROUTE_OPTIONS): RouteOption[] {
  const kept: RouteOption[] = [];
  for (const option of all) {
    if (kept.length >= max) break;
    const isNearDuplicate = kept.some(
      (existing) =>
        sameModeSet(existing.modes, option.modes) &&
        Math.abs(existing.durationMinutes - option.durationMinutes) <
          NEAR_DUPLICATE_THRESHOLD_MINUTES
    );
    if (isNearDuplicate) continue;
    kept.push(option);
  }
  return kept.map((option, index) => ({ ...option, recommended: index === 0 }));
}

/** modes 是否为同一集合（忽略出现顺序） */
function sameModeSet(a: RouteTransportMode[], b: RouteTransportMode[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((mode, i) => mode === sortedB[i]);
}

// ---- 腾讯 direction v1 响应 DTO ----
// 结构依据 lbs.qq.com 官方文档（2026-04 lastmod）：transit 路线分段为
// steps[]（按 mode=WALKING|TRANSIT 分派），乘车段在 lines[] 内带 geton/getoff/stations；
// 票价字段 route.price 配合请求参数 price_unit=1 统一为「分」。
// 全部字段视为可能缺失（防御式）：解析一律走 unknown 收窄助手，不做非空断言。
interface TencentDirectionResponseDto {
  status?: unknown;
  message?: unknown;
  result?: unknown;
}

interface TencentDirectionResultDto {
  routes?: unknown;
}

interface TencentRouteDto {
  /** 总时长（分钟） */
  duration?: unknown;
  /** 总距离（米） */
  distance?: unknown;
  /** 总票价：price_unit=1 时单位为分；-1/缺失表示无票价 */
  price?: unknown;
  /** 策略标签：仅当为字符串标签时才透传为 summary，数字编码不猜测含义 */
  strategy?: unknown;
  /** 分段列表（walking 为指引步；transit 按 mode 分派 WALKING/TRANSIT） */
  steps?: unknown;
}

/** walking 路线的单个指引步（也用于 transit WALKING 段的内部 steps） */
interface TencentWalkInstructionDto {
  instruction?: unknown;
}

/** transit 路线的单个分段：mode 决定内部结构 */
interface TencentRouteStepDto {
  mode?: unknown;
  distance?: unknown;
  duration?: unknown;
  /** WALKING 段的内部指引步 */
  steps?: unknown;
  /** WALKING 段压缩折线 [lat0,lng0,dLat1,dLng1,...]，首点为原值 */
  polyline?: unknown;
  /** TRANSIT 段的可乘线路 */
  lines?: unknown;
}

interface TencentLineDto {
  /** 线路名，如「地铁3号线」 */
  title?: unknown;
  vehicle?: unknown;
  distance?: unknown;
  duration?: unknown;
  /** 线路票价：-1 表示缺票价 */
  price?: unknown;
  geton?: unknown;
  getoff?: unknown;
}

interface TencentStopDto {
  /** 站点名为 title（旧版为 name，两者都兼容读取） */
  title?: unknown;
  name?: unknown;
  location?: unknown;
}

// ---- unknown 收窄助手（strict TS 下安全解析任意 JSON 形状） ----
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toLatLng(value: unknown): { latitude: number; longitude: number } | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const lat = toFiniteNumber(record.lat);
  const lng = toFiniteNumber(record.lng);
  return lat !== undefined && lng !== undefined ? { latitude: lat, longitude: lng } : undefined;
}

/** 站点名兼容读取：现行字段为 title，旧版为 name */
function readStopName(stop: Record<string, unknown> | null): string | undefined {
  if (!stop) return undefined;
  const dto: TencentStopDto = stop;
  return toTrimmedString(dto.title) ?? toTrimmedString(dto.name);
}

/**
 * 压缩折线首点坐标：官方格式为一维数组 [lat0, lng0, dLat1, dLng1, ...]，
 * 首点为原值（不做差分还原），后续点需 coors[i]=coors[i-2]+coors[i]/1000000。
 * 本项目当前只取首点做节点定位，无需全量解压。
 */
function firstPolylinePoint(polyline: unknown): { latitude: number; longitude: number } | undefined {
  const points = toArray(polyline);
  const latitude = toFiniteNumber(points[0]);
  const longitude = toFiniteNumber(points[1]);
  return latitude !== undefined && longitude !== undefined
    ? { latitude, longitude }
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 截断 provider 文案作为节点标题（避免超长 instruction 撑破卡片） */
function truncateText(text: string, maxLength = 18): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/** 适配上下文：目的地名称用于 ARRIVAL 节点；departureTimeIso 用于推算到达时刻 */
export interface DirectionAdapterContext {
  destinationName?: string;
  departureTimeIso?: string;
}

/** direction v1 支持的两种模式 */
export type TencentDirectionMode = 'transit' | 'walking';

/**
 * 腾讯 direction v1 响应 → RouteOption[] 适配器。
 * 防御式假设：
 * - duration/distance 缺失或非有限数 → 整条路线丢弃（宁缺毋假）；
 * - transit 无有效 segments 可构造时间轴 → 丢弃该条；
 * - estimatedCost：direction v1 不提供可信票价字段，恒为 undefined，绝不猜测；
 * - summary：仅当 strategy 为非空字符串标签时透传；数字策略编码含义不明，不翻译；
 * - departureTime/arrivalTime：仅当请求带 departureTime 才按 duration 推算（ISO-8601 UTC），
 *   否则两者皆 undefined（UI 呈现「尽快出发」语义）。
 */
export class TencentDirectionAdapter {
  /** 把 direction 响应整体映射为 RouteOption[]（无效路线直接跳过） */
  toRouteOptions(
    resultDto: unknown,
    mode: TencentDirectionMode,
    context?: DirectionAdapterContext
  ): RouteOption[] {
    const root = asRecord(resultDto);
    const result = root ? asRecord(root.result) : null;
    const resultRecord: TencentDirectionResultDto = result ?? {};
    const routes = toArray(resultRecord.routes);
    const options: RouteOption[] = [];
    routes.forEach((rawRoute, index) => {
      const mapped =
        mode === 'transit'
          ? this.mapTransitRoute(rawRoute, index, context)
          : this.mapWalkingRoute(rawRoute, index, context);
      if (mapped) options.push(mapped);
    });
    return options;
  }

  // ---- walking：route.steps[{instruction, polyline, distance, duration}] ----
  private mapWalkingRoute(
    rawRoute: unknown,
    index: number,
    context?: DirectionAdapterContext
  ): RouteOption | null {
    const route = asRecord(rawRoute);
    if (!route) return null;
    const durationMinutes = toFiniteNumber(route.duration);
    if (durationMinutes === undefined || durationMinutes <= 0) return null;
    const distanceMeters = toFiniteNumber(route.distance);

    const steps: RouteStep[] = [];
    const rawSteps = toArray(route.steps).slice(0, MAX_WALKING_STEPS);
    if (rawSteps.length === 0) {
      // steps 缺失时退化为单一「步行」节点 + 到达，仍可展示总时长/距离
      steps.push({ type: 'WALK', title: '步行', distanceMeters });
    } else {
      for (const rawStep of rawSteps) {
        const step = asRecord(rawStep);
        if (!step) continue;
        const stepDistance = toFiniteNumber(step.distance);
        const instruction = toTrimmedString(step.instruction);
        const coords = firstPolylinePoint(step.polyline);
        steps.push({
          type: 'WALK',
          title: instruction ? truncateText(instruction) : '步行',
          subtitle: stepDistance !== undefined ? `约 ${Math.round(stepDistance)} 米` : undefined,
          durationMinutes: toFiniteNumber(step.duration),
          distanceMeters: stepDistance,
          ...(coords ?? {}),
        });
      }
    }
    steps.push(this.arrivalStep(context));
    return this.assembleOption({
      id: `route_walking_${index + 1}`,
      durationMinutes,
      distanceMeters,
      modes: ['WALK'],
      steps,
      rawStrategy: route.strategy,
      context,
    });
  }

  // ---- transit：route.steps[]{mode: WALKING|TRANSIT}，乘车段在 lines[] ----
  private mapTransitRoute(
    rawRoute: unknown,
    index: number,
    context?: DirectionAdapterContext
  ): RouteOption | null {
    const route = asRecord(rawRoute);
    if (!route) return null;
    const durationMinutes = toFiniteNumber(route.duration);
    if (durationMinutes === undefined || durationMinutes <= 0) return null;
    const distanceMeters = toFiniteNumber(route.distance);

    const steps: RouteStep[] = [];
    const modes: RouteTransportMode[] = [];
    const pushMode = (mode: RouteTransportMode): void => {
      if (!modes.includes(mode)) modes.push(mode);
    };

    for (const rawStep of toArray(route.steps)) {
      const step = asRecord(rawStep);
      if (!step) continue;
      const mode = toTrimmedString(step.mode);
      if (mode === 'WALKING') {
        this.appendWalkingNode(step, steps, pushMode);
      } else if (mode === 'TRANSIT') {
        this.appendLineNodes(step, steps, pushMode);
      }
      // 其他/未知 mode：跳过，不编造展示内容
    }

    if (steps.length === 0) return null; // 无法构造时间轴的路线不展示
    steps.push(this.arrivalStep(context));
    return this.assembleOption({
      id: `route_transit_${index + 1}`,
      durationMinutes,
      distanceMeters,
      modes,
      steps,
      rawStrategy: route.strategy,
      rawPrice: route.price,
      context,
    });
  }

  /**
   * TRANSIT 段聚合为一个步行节点：有距离/时长/内部指引任一才视为有效。
   * 标题取第一条内部指引（截断），坐标取压缩折线首点（首点为原值）。
   */
  private appendWalkingNode(
    step: Record<string, unknown>,
    steps: RouteStep[],
    pushMode: (mode: RouteTransportMode) => void
  ): void {
    const innerSteps = toArray(step.steps);
    const distanceMeters = toFiniteNumber(step.distance);
    const durationMinutes = toFiniteNumber(step.duration);
    const hasContent =
      innerSteps.length > 0 ||
      (distanceMeters !== undefined && distanceMeters > 0) ||
      (durationMinutes !== undefined && durationMinutes > 0);
    if (!hasContent) return;

    const firstInstruction = innerSteps
      .map(asRecord)
      .map((record) => toTrimmedString((record as TencentWalkInstructionDto | null)?.instruction))
      .find((value): value is string => value !== undefined);
    const coords = firstPolylinePoint(step.polyline);
    steps.push({
      type: 'WALK',
      title: firstInstruction ? truncateText(firstInstruction) : '步行',
      subtitle:
        distanceMeters !== undefined && distanceMeters > 0
          ? `约 ${Math.round(distanceMeters)} 米`
          : undefined,
      durationMinutes,
      distanceMeters,
      ...(coords ?? {}),
    });
    pushMode('WALK');
  }

  /**
   * TRANSIT 段的乘车线路（可能多程）；vehicle=SUBWAY 归 METRO，
   * 其余按线路名兜底启发式（含「地铁/号线」→ METRO），再否则 BUS。
   * 节点标题=线路名，副标题=「上车站 → 下车站」，坐标=上车站位置。
   */
  private appendLineNodes(
    step: Record<string, unknown>,
    steps: RouteStep[],
    pushMode: (mode: RouteTransportMode) => void
  ): void {
    for (const rawLine of toArray(step.lines)) {
      const line = asRecord(rawLine);
      if (!line) continue;
      const dto: TencentLineDto = line;
      const displayName = toTrimmedString(dto.title) ?? toTrimmedString(line.line);
      if (!displayName) continue; // 连线路名都没有的乘车线路无法展示

      const geton = asRecord(dto.geton);
      const getoff = asRecord(dto.getoff);
      const onName = readStopName(geton);
      const offName = readStopName(getoff);
      const onLocation = geton ? toLatLng(geton.location) : undefined;
      const subtitle = onName && offName ? `${onName} → ${offName}` : undefined;

      steps.push({
        type: 'TRANSIT',
        title: displayName,
        subtitle,
        durationMinutes: toFiniteNumber(dto.duration),
        distanceMeters: toFiniteNumber(dto.distance),
        ...(onLocation ?? {}),
      });
      pushMode(this.classifyLineMode(displayName, toTrimmedString(dto.vehicle)));
    }
  }

  /** SUBWAY → METRO；其余 vehicle 先按名称启发式兜底，最后落 BUS */
  private classifyLineMode(
    displayName: string,
    vehicle: string | undefined
  ): RouteTransportMode {
    if (vehicle === 'SUBWAY') return 'METRO';
    if (this.isMetroLine(displayName)) return 'METRO';
    return 'BUS';
  }

  private isMetroLine(lineName: string): boolean {
    return lineName.includes('地铁') || lineName.includes('号线');
  }

  private arrivalStep(context?: DirectionAdapterContext): RouteStep {
    return { type: 'ARRIVAL', title: context?.destinationName ?? '目的地' };
  }

  /**
   * 组装 RouteOption：
   * - estimatedCost：仅 transit 且 route.price 为正数时填充。请求已带 price_unit=1
   *   （官方参数：票价统一为「分」），故换算 /100 为元；缺失/非正数一律 undefined，绝不猜测；
   * - summary：strategy 仅在为字符串标签时透传，数字编码不解读；
   * - departureTime/arrivalTime：仅有请求出发时刻时按 duration 推算（UTC ISO-8601，
   *   展示层统一换算东八区）。
   */
  private assembleOption(input: {
    id: string;
    durationMinutes: number;
    distanceMeters?: number;
    modes: RouteTransportMode[];
    steps: RouteStep[];
    rawStrategy: unknown;
    rawPrice?: unknown;
    context?: DirectionAdapterContext;
  }): RouteOption {
    const times = this.computeTimes(input.durationMinutes, input.context);
    const priceFen =
      input.rawPrice !== undefined ? toFiniteNumber(input.rawPrice) : undefined;
    const estimatedCost =
      priceFen !== undefined && priceFen > 0
        ? { amount: Number((priceFen / 100).toFixed(2)), currency: 'CNY' }
        : undefined;
    return {
      id: input.id,
      recommended: false, // 由 selectTopRouteOptions 统一归一化标记
      durationMinutes: input.durationMinutes,
      ...(input.distanceMeters !== undefined ? { distanceMeters: input.distanceMeters } : {}),
      ...(estimatedCost !== undefined ? { estimatedCost } : {}),
      ...times,
      summary: toTrimmedString(input.rawStrategy),
      modes: input.modes,
      steps: input.steps,
    };
  }

  private computeTimes(
    durationMinutes: number,
    context?: DirectionAdapterContext
  ): { departureTime?: string; arrivalTime?: string } {
    if (!context?.departureTimeIso) return {};
    const departureMs = Date.parse(context.departureTimeIso);
    if (!Number.isFinite(departureMs)) return {};
    const arrivalMs = departureMs + durationMinutes * 60 * 1000;
    return {
      departureTime: new Date(departureMs).toISOString(),
      arrivalTime: new Date(arrivalMs).toISOString(),
    };
  }
}

/**
 * 路线规划 Provider：
 * 1. 配置门禁（未配置真实 Key → NOT_CONFIGURED）；
 * 2. 出发地前置校验（页面须先授权定位再传入 origin → 缺失即 PERMISSION_DENIED）；
 * 3. 目的地经 POI 搜索解析为坐标（无结果 → GEOCODE_FAILED）；
 * 4. transit + walking 并行请求（Promise.allSettled，单个失败不影响另一个）；
 * 5. 合并去重后取 top-3，第一条即 recommended。
 */
export class TencentDirectionProvider {
  private readonly adapter = new TencentDirectionAdapter();

  get isConfigured(): boolean {
    return isTencentMapConfigured();
  }

  async plan(query: RoutePlanQuery): Promise<RoutePlanResult> {
    if (!this.isConfigured) {
      throw new RouteOptionError('NOT_CONFIGURED', '未配置腾讯地图 Key，无法规划真实路线');
    }
    if (!query.origin) {
      throw new RouteOptionError('PERMISSION_DENIED', '缺少出发地定位：请先授权定位后再查询路线');
    }

    const destination = await this.resolveDestination(query);

    const from = `${query.origin.latitude},${query.origin.longitude}`;
    const to = `${destination.latitude},${destination.longitude}`;
    const adapterContext: DirectionAdapterContext = {
      destinationName: destination.name,
      departureTimeIso: query.departureTime,
    };

    const [transitOutcome, walkingOutcome] = await Promise.allSettled([
      this.requestDirection(tencentMapConfig.directionTransitUrl, from, to, {
        price_unit: 1,
      }).then((dto) => this.adapter.toRouteOptions(dto, 'transit', adapterContext)),
      this.requestDirection(tencentMapConfig.directionWalkingUrl, from, to).then((dto) =>
        this.adapter.toRouteOptions(dto, 'walking', adapterContext)
      ),
    ]);

    const options: RouteOption[] = [];
    const errors: unknown[] = [];
    for (const outcome of [transitOutcome, walkingOutcome]) {
      if (outcome.status === 'fulfilled') {
        options.push(...outcome.value);
      } else {
        errors.push(outcome.reason);
      }
    }

    if (options.length === 0) {
      if (errors.length > 0) {
        const firstError = errors[0];
        if (firstError instanceof RouteOptionError) throw firstError;
        throw new RouteOptionError('PROVIDER_ERROR', `路线规划失败: ${errorMessage(firstError)}`);
      }
      throw new RouteOptionError('NO_ROUTE', `未找到可行路线: ${destination.name}`);
    }

    return {
      options: selectTopRouteOptions(options, MAX_ROUTE_OPTIONS),
      resolvedDestination: destination,
    };
  }

  /** 目的地名称 → 坐标：复用地点搜索 Provider，取第一条 POI 结果 */
  private async resolveDestination(query: RoutePlanQuery): Promise<ResolvedDestination> {
    try {
      const hits = await tencentMapProvider.searchPlaces({
        keyword: query.destinationName,
        city: query.city,
        pageSize: 1,
      });
      const first = hits[0];
      // Location 的坐标为可选字段：缺坐标的 POI 无法用于路线规划，按解析失败处理
      if (!first || first.latitude === undefined || first.longitude === undefined) {
        throw new RouteOptionError('GEOCODE_FAILED', `目的地解析失败: ${query.destinationName}`);
      }
      return { name: first.name, latitude: first.latitude, longitude: first.longitude };
    } catch (error) {
      if (error instanceof RouteOptionError) throw error;
      throw new RouteOptionError(
        'GEOCODE_FAILED',
        `目的地搜索失败: ${query.destinationName}（${errorMessage(error)}）`
      );
    }
  }

  /** 调用 direction v1；wx.request fail → NETWORK_ERROR，API 非 0 status → PROVIDER_ERROR */
  private requestDirection(
    url: string,
    from: string,
    to: string,
    extraParams?: Record<string, string | number>
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      wx.request({
        url,
        method: 'GET',
        data: { key: tencentMapConfig.key, from, to, ...(extraParams ?? {}) },
        success: (res) => {
          const body = res.data as TencentDirectionResponseDto;
          const status = toFiniteNumber(body.status) ?? -1;
          if (status !== 0) {
            reject(
              new RouteOptionError(
                'PROVIDER_ERROR',
                `腾讯路线规划返回异常(${status}): ${toTrimmedString(body.message) ?? '未知错误'}`
              )
            );
            return;
          }
          resolve(body);
        },
        fail: (err) =>
          reject(new RouteOptionError('NETWORK_ERROR', `路线请求网络失败: ${err.errMsg}`)),
      });
    });
  }
}

/** 单例 */
export const tencentDirectionProvider = new TencentDirectionProvider();
