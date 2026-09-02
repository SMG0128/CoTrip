// trip-plan-post-processor.ts
// AI Trip Pipeline 确定性后处理层。
//
// 在 AI 返回行程 snapshot 之后、落库之前执行，负责把 LLM 的「意图」修正为
// 确定性的、锚定到行程日期的、truth-preserving 的最终计划：
//
//   B. 时间解析：把活动时间锚定到 trip.startDate，禁止用当前系统时间填充。
//   C. 时长解析：把「看三个小时」解析为 durationMinutes 并应用到活动 end。
//   D. 先后关系：把「去完X后去Y」解析为 afterActivityId + near_previous_activity。
//   E/F. POI 解析：把 locationQuery 解析为真实腾讯 POI；附近餐厅用腾讯 nearby 搜索。
//   G/H/I. truth-preserving + 确定性排序 + 禁止 mock fallback。
//   J. 最终时间：活动不重叠，后续活动 start = 前一活动 end + travel。
//
// 本模块是纯逻辑 + 可注入的 Tencent LBS 依赖，便于确定性测试。

import { TripPlan, TripPlanEvent } from '../types/trip-plan';
import { parseDurationMinutes } from './duration-parser';
import { buildTimeAnchor, resolvePlanTimes } from './trip-temporal-resolution';
import {
  resolveSequenceConstraints,
  SequencedTripPlanEvent,
  normalizePlaceKeyword,
} from './trip-sequence-resolution';
import { PlaceCandidate, TencentLBSService } from './tencent-lbs-service';
import {
  TencentDirectionMode,
  TencentDirectionService,
  TencentRouteResult,
  resolveDirectionMode,
} from './tencent-direction-service';
import { rankPlaceCandidates, RankedPlaceCandidate } from './place-candidate-ranker';
import { isResolvedPhysicalLocation } from './resolved-physical-location';

/** 解析后的活动：在既有 TripPlanEvent 基础上附加可选字段（全部向后兼容） */
export interface ResolvedTripEvent extends SequencedTripPlanEvent {
  /** 解析出的真实地点（来自腾讯 POI，字段与前端 Location 对齐） */
  resolvedLocation?: {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    address?: string;
    providerRefs?: { provider: 'tencent'; externalId: string }[];
  };
  /**
   * 附近餐厅候选（内部：全部来自腾讯 API，确定性排序后 top 写入最终 plan 的
   * restaurant + restaurantCandidates）。与 TripPlanEvent.restaurantCandidates
   * （持久化形状）分离，避免两种形状互相干扰。
   */
  rankedRestaurantCandidates?: RankedPlaceCandidate[];
  /** 地点解析状态 */
  locationStatus?: 'resolved' | 'unresolved' | 'search_unavailable';
}

export interface PostProcessInput {
  /** AI 生成的计划（已通过 schema 校验） */
  plan: TripPlan;
  /** 行程时间范围（用于锚定日期） */
  timeRange?: { start?: string; end?: string; timezone?: string };
  /** 触发评论原文（用于提取时长 / 先后关系） */
  commentText?: string;
  /** 行程城市（用于 POI disambiguation） */
  city?: string;
  /** 用户预算偏好（人均上限，元） */
  budgetMaxPerPerson?: number;
  /** 是否偏好低价 */
  preferLowCost?: boolean;
  /** 用户明确指定的交通偏好（步行/地铁/公交/打车…）；未指定时使用项目默认推荐逻辑 */
  routeMode?: string;
}

export interface PostProcessResult {
  plan: TripPlan;
  /** 每个事件的解析详情（含 POI / 候选 / 状态） */
  events: ResolvedTripEvent[];
}

/**
 * 把「去完X后去Y」的先后关系应用到时间上，保证活动不重叠。
 *
 * 关键约束（FINAL CLEANUP）：
 *   - 绝不凭空生成 travel duration。未获得真实路线 duration 时，后续活动
 *     start = 前一活动 end（最早不重叠时刻），不声称存在任何真实 travel。
 *   - 若调用方提供了真实路线 duration（来自项目已有 Tencent route service），
 *     则 start = 前一活动 end + realTravelMinutes。
 *   - 本模块不新造第二套路由系统；真实 route duration 由外部注入。
 *
 * @param realTravelMinutesByEventId 可选：真实路线 duration（分钟），key 为活动 id。
 *   仅当来自真实 route provider 时提供；缺省表示无真实路线，不伪造 travel。
 */
export function applySequenceTimes(
  events: ResolvedTripEvent[],
  realTravelMinutesByEventId?: ReadonlyMap<string, number>,
): ResolvedTripEvent[] {
  const byId = new Map(events.map((e) => [e.id, e]));
  const result = events.map((e) => ({ ...e }));

  for (const event of result) {
    const seq = event.sequenceConstraint;
    if (!seq) continue;
    const prior = byId.get(seq.afterActivityId);
    if (!prior || !prior.time.end) continue;

    const priorEnd = new Date(prior.time.end).getTime();
    // 真实路线 duration（分钟）；无真实数据时为 0，即 start = previous.end，不伪造 travel
    const realTravelMs = (realTravelMinutesByEventId?.get(event.id) ?? 0) * 60_000;
    const earliestStart = new Date(priorEnd + realTravelMs);
    // event[i+1].start = max(已有硬约束 start, event[i].end + 真实路线 duration)
    const existingStart = new Date(event.time.start).getTime();
    const nextStart = new Date(Math.max(existingStart, earliestStart.getTime()));
    const startIso = toLocalIso(nextStart);
    const durationMs = event.time.end
      ? new Date(event.time.end).getTime() - new Date(event.time.start).getTime()
      : 0;
    event.time = {
      ...event.time,
      start: startIso,
      ...(durationMs > 0 ? { end: toLocalIso(new Date(nextStart.getTime() + durationMs)) } : {}),
    };
  }
  return result;
}

/** Date → 本地 +08:00 ISO（与项目时区一致）。
 * 注意：toISOString() 返回 UTC，需先加 8 小时得到 +08:00 墙钟时间再格式化。 */
function toLocalIso(date: Date): string {
  const local = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return local.toISOString().replace(/\.\d{3}Z$/, '+08:00');
}

/**
 * 对单个活动应用时长：若活动有 durationMinutes（来自评论解析），
 * 则 end = start + durationMinutes。
 */
function applyDuration(
  event: ResolvedTripEvent,
  durationMinutes: number | undefined,
): ResolvedTripEvent {
  if (durationMinutes === undefined || !event.time.start) return event;
  const start = new Date(event.time.start).getTime();
  const end = new Date(start + durationMinutes * 60_000);
  return {
    ...event,
    time: {
      ...event.time,
      end: toLocalIso(end),
    },
  };
}

/**
 * 主入口：对 AI 生成的计划做确定性后处理。
 * 返回修正后的 plan 与逐事件解析结果。
 */
export async function postProcessTripPlan(
  input: PostProcessInput,
  lbs: TencentLBSService | null,
  directions?: TencentDirectionService | null,
): Promise<PostProcessResult> {
  const anchor = buildTimeAnchor(input.timeRange);
  const city = input.city || '广州市';

  // 1. 时间锚定（B/J）
  let events: ResolvedTripEvent[] = anchor
    ? (resolvePlanTimes(input.plan.events, anchor) as ResolvedTripEvent[])
    : input.plan.events.map((e) => ({ ...e }));

  // 2. 时长解析（C）：从评论提取时长，绑定到最近、语义相关的活动
  const duration = input.commentText ? parseDurationMinutes(input.commentText) : { ok: false };
  if (duration.ok && duration.durationMinutes !== undefined && events.length > 0) {
    // 优先绑定到与时长上下文语义相关的活动（如「看三个小时」→ 看书活动），
    // 找不到时回退到最后一个活动。
    const targetIndex = findDurationTargetIndex(events, input.commentText ?? '');
    events[targetIndex] = applyDuration(events[targetIndex], duration.durationMinutes);
  }

  // 3. 先后关系（D）：标题法 + 评论驱动法（含 compound sequence A→B→C 通用链接）
  events = resolveSequenceConstraints(events, input.commentText) as ResolvedTripEvent[];

  // 4. POI 解析（E/F/G/H/I）：真实地点 + 附近餐厅候选
  if (lbs) {
    events = await resolvePOIs(events, city, lbs, input);
  }

  // 5. 真实路线（G/H/I/J/K/M）：对相邻已解析活动调用 Tencent direction，
  //    真实 duration 参与排程；方向 API 不可用时不产生 route、不伪造 travel。
  //    餐厅活动以真实餐厅坐标为路线终点（餐厅不是排程例外）。
  let realTravelMinutesByEventId: ReadonlyMap<string, number> | undefined;
  if (directions) {
    events = await applyRealRoutes(events, directions, input.routeMode);
    realTravelMinutesByEventId = collectRealTravelMinutes(events);
  }

  // 6. 时间不重叠（J/L）：按先后关系 + 真实路线 duration 调整后续活动时间。
  //    event[i+1].start = max(已有硬约束 start, event[i].end + realRouteDuration)；
  //    无真实路线 duration 时 start = previous.end（不伪造 travel）。
  events = applySequenceTimes(events, realTravelMinutesByEventId);

  const plan: TripPlan = {
    ...input.plan,
    events: events.map((event) => {
      const {
        sequenceConstraint,
        resolvedLocation,
        rankedRestaurantCandidates,
        locationStatus,
        route,
        ...rest
      } = event;
      const planEvent: TripPlanEvent = {
        ...rest,
        ...(sequenceConstraint ? { sequenceConstraint } : {}),
      };
      // Provider 验证后的真实地点写入 event.location（前端可直接展示）
      if (resolvedLocation) {
        planEvent.location = resolvedLocation;
      }
      // 附近餐厅：top 候选写入 event.restaurant（前端「当前首选」），
      // 其余真实候选写入 event.restaurantCandidates（前端「查看 N 个备选」）。
      if (rankedRestaurantCandidates && rankedRestaurantCandidates.length > 0) {
        const toRestaurant = (candidate: RankedPlaceCandidate): NonNullable<TripPlanEvent['restaurant']> => {
          const providerRefs = [{ provider: 'tencent' as const, externalId: candidate.providerPoiId }];
          return {
            id: candidate.providerPoiId,
            name: candidate.name,
            location: {
              id: candidate.providerPoiId,
              name: candidate.name,
              latitude: candidate.latitude,
              longitude: candidate.longitude,
              ...(candidate.address ? { address: candidate.address } : {}),
              providerRefs,
            },
            ...(typeof candidate.distanceMeters === 'number'
              ? { distanceMeters: candidate.distanceMeters }
              : {}),
            // truth-preserving：仅当腾讯真实返回 rating / avgPrice 时才写入
            ...(typeof candidate.rating === 'number' ? { rating: { score: candidate.rating } } : {}),
            ...(typeof candidate.avgPrice === 'number'
              ? { averagePrice: { amount: candidate.avgPrice, currency: 'CNY', unit: 'per_person' } }
              : {}),
            providerRefs,
          };
        };
        planEvent.restaurant = toRestaurant(rankedRestaurantCandidates[0]);
        planEvent.restaurantCandidates = rankedRestaurantCandidates.map(toRestaurant);
      }
      // 真实路线段写入 event.route（final plan 数据必须保存真实 route segment）
      if (route) {
        planEvent.route = route;
      }
      return planEvent;
    }),
  };

  return { plan, events };
}

/** 事件的实际物理坐标：餐厅事件优先用真实餐厅坐标（M 节），其余用解析后的真实地点。 */
function eventPhysicalLocation(event: ResolvedTripEvent): { latitude: number; longitude: number } | undefined {
  if (event.rankedRestaurantCandidates && event.rankedRestaurantCandidates.length > 0) {
    const top = event.rankedRestaurantCandidates[0];
    if (Number.isFinite(top.latitude) && Number.isFinite(top.longitude)) {
      return { latitude: top.latitude, longitude: top.longitude };
    }
  }
  const resolved = event.resolvedLocation;
  if (resolved && Number.isFinite(resolved.latitude) && Number.isFinite(resolved.longitude)) {
    return { latitude: resolved.latitude, longitude: resolved.longitude };
  }
  return undefined;
}

/**
 * 对相邻的已解析真实坐标活动调用 Tencent direction，把真实 route 段挂到被到达的活动上。
 *
 * mode 规则（I 节）：
 *   - 用户明确指定（步行/地铁/公交/打车…）→ 尊重并只用该 mode。
 *   - 未指定 → 同时获取 walking / transit 真实候选，选择 duration 最短者；平局 walking 优先。
 *
 * 失败（J 节）：route 不写入、duration 不参与排程、sequence 保留 —— 绝不伪造 travel time。
 */
export function selectBestRealRoute(
  candidates: readonly TencentRouteResult[],
): TencentRouteResult | undefined {
  const modePriority: Record<TencentDirectionMode, number> = {
    walking: 0,
    transit: 1,
    driving: 2,
  };
  return candidates.reduce<TencentRouteResult | undefined>((best, candidate) => {
    if (!best) return candidate;
    if (candidate.durationMinutes !== best.durationMinutes) {
      return candidate.durationMinutes < best.durationMinutes ? candidate : best;
    }
    return modePriority[candidate.mode] < modePriority[best.mode] ? candidate : best;
  }, undefined);
}

async function applyRealRoutes(
  events: ResolvedTripEvent[],
  directions: TencentDirectionService,
  routeModePreference?: string,
): Promise<ResolvedTripEvent[]> {
  const userMode = resolveDirectionMode(routeModePreference);
  const result: ResolvedTripEvent[] = events.map((e) => ({ ...e }));

  for (let i = 0; i + 1 < result.length; i += 1) {
    const from = eventPhysicalLocation(result[i]);
    const to = eventPhysicalLocation(result[i + 1]);
    if (!from || !to) continue;

    const modes: TencentDirectionMode[] = userMode
      ? [userMode]
      : ['walking', 'transit'];

    // 失败（R 节）：provider 抛错 / 网络异常 / 无 route 一律不进入候选，
    // 两种自动模式都不可用时不写 route，绝不补 mock duration。
    const candidates = (
      await Promise.all(
        modes.map(async (mode): Promise<TencentRouteResult | undefined> => {
          try {
            const outcome = await directions.getDirection(from, to, mode);
            return outcome.status === 'FOUND' ? { ...outcome.route, mode } : undefined;
          } catch {
            return undefined;
          }
        }),
      )
    ).filter((candidate): candidate is TencentRouteResult => candidate !== undefined);
    const route = selectBestRealRoute(candidates);
    if (!route) continue;

    result[i + 1].route = {
      fromEventId: result[i].id,
      ...route,
      provider: 'tencent',
    };
  }
  return result;
}

/** 汇总各活动真实路线 duration（分钟），供排程使用。 */
function collectRealTravelMinutes(events: ResolvedTripEvent[]): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  for (const event of events) {
    if (event.route && Number.isFinite(event.route.durationMinutes) && event.route.durationMinutes > 0) {
      map.set(event.id, event.route.durationMinutes);
    }
  }
  return map;
}

/** 为每个活动解析真实 POI 与附近餐厅候选（按顺序，后续活动可复用前置活动坐标） */
async function resolvePOIs(
  events: ResolvedTripEvent[],
  city: string,
  lbs: TencentLBSService,
  input: PostProcessInput,
): Promise<ResolvedTripEvent[]> {
  const result: ResolvedTripEvent[] = [];
  for (const event of events) {
    result.push(await resolveEventPOI(event, city, lbs, input, result));
  }
  return result;
}

/** 解析单个活动的 POI + 附近餐厅 */
async function resolveEventPOI(
  event: ResolvedTripEvent,
  city: string,
  lbs: TencentLBSService,
  input: PostProcessInput,
  resolvedSoFar: ResolvedTripEvent[],
): Promise<ResolvedTripEvent> {
  const seq = event.sequenceConstraint;
  const prior = seq
    ? resolvedSoFar.find((e) => e.id === seq.afterActivityId)
    : undefined;
  const priorLocation = prior?.resolvedLocation;

  // 从标题提取地点关键词（通用：任意需要实体地点的活动都尝试解析）
  const locationQuery = extractPlaceQuery(event.title);

  // 锚点/地点解析优先级（B 节，全局规则）：
  //   1. 本活动标题里的明确地点（locationQuery）→ POI 解析。
  //      活动自身的地点优先于任何前置坐标 —— 例如「参观省博物馆」即使排在
  //      「广州图书馆看书」之后，也绝不把图书馆坐标当作博物馆坐标。
  //   2. 无明确地点且 sequenceConstraint 前置活动已解析 → 复用前置真实坐标
  //      （near_previous_activity，如「去完省博吃越南菜」的 nearby 锚点）。
  //   3. 无 sequenceConstraint 时 → 回看最近一个已解析真实坐标的前置活动
  //      （「晚上附近吃粤菜」这类省略地点的餐饮意图）。
  //   4. 以上都没有 → unresolved，不伪造地点。
  let resolvedLat: number | undefined;
  let resolvedLng: number | undefined;
  let resolvedLocation: ResolvedTripEvent['resolvedLocation'];
  let locationStatus: ResolvedTripEvent['locationStatus'] = 'unresolved';

  if (locationQuery) {
    // 「去完广图吃泰国菜」：anchor 与前置活动地点一致时复用前置真实坐标，
    // 避免对「广图」这类简称再做一次有风险的 POI 搜索。
    if (prior && priorLocation && priorMatchesLocationQuery(prior, locationQuery)) {
      resolvedLat = priorLocation.latitude;
      resolvedLng = priorLocation.longitude;
      resolvedLocation = priorLocation;
      locationStatus = 'resolved';
    } else {
      const poiOutcome = await lbs.searchPOI(locationQuery, city);
      if (poiOutcome.status === 'FOUND' && poiOutcome.candidates.length > 0) {
        const top = poiOutcome.candidates.find(isResolvedPhysicalLocation);
        if (!top) {
          locationStatus = 'unresolved';
        } else {
          resolvedLat = top.latitude;
          resolvedLng = top.longitude;
          resolvedLocation = {
            id: top.providerPoiId,
            name: top.name,
            latitude: top.latitude,
            longitude: top.longitude,
            ...(top.address ? { address: top.address } : {}),
            providerRefs: [{ provider: 'tencent', externalId: top.providerPoiId }],
          };
          locationStatus = 'resolved';
        }
      } else {
        locationStatus =
          poiOutcome.status === 'POI_SEARCH_UNAVAILABLE' ? 'search_unavailable' : 'unresolved';
      }
    }
  } else if (prior && priorLocation) {
    // 复用前置活动真实坐标（near_previous_activity）
    resolvedLat = priorLocation.latitude;
    resolvedLng = priorLocation.longitude;
    resolvedLocation = priorLocation;
    locationStatus = 'resolved';
  } else {
    // 回看最近一个已解析真实坐标的前置活动（省略地点的餐饮意图通用锚点）
    for (let i = resolvedSoFar.length - 1; i >= 0; i -= 1) {
      const anchor = resolvedSoFar[i].resolvedLocation;
      if (anchor) {
        resolvedLat = anchor.latitude;
        resolvedLng = anchor.longitude;
        resolvedLocation = anchor;
        locationStatus = 'resolved';
        break;
      }
    }
  }

  const resolvedEvent: ResolvedTripEvent = {
    ...event,
    ...(resolvedLocation ? { resolvedLocation } : {}),
    locationStatus,
  };

  // 若活动是餐饮（DINING）或标题含「吃/菜/餐」，则搜索附近餐厅
  // 全局规则（A/B/P 节）：meal intent + foodKeyword + 可解析 anchor → 腾讯 nearby
  if (event.type === 'DINING' || isMealTitle(event.title)) {
    const keyword = extractFoodKeyword(event.title) || '餐厅';
    if (resolvedLat !== undefined && resolvedLng !== undefined) {
      const nearby = await lbs.searchNearby(keyword, resolvedLat, resolvedLng);
      if (nearby.status === 'FOUND') {
        resolvedEvent.rankedRestaurantCandidates = rankPlaceCandidates(
          nearby.candidates.filter(isResolvedPhysicalLocation),
          keyword,
          {
            budgetMaxPerPerson: input.budgetMaxPerPerson,
            preferLowCost: input.preferLowCost,
          },
        );
      }
    }
  }

  return resolvedEvent;
}

/** 前置活动的地点是否与标题提取的地点关键词一致（含别名归一化） */
function priorMatchesLocationQuery(
  prior: ResolvedTripEvent,
  locationQuery: string,
): boolean {
  const priorPlace = extractPlaceQuery(prior.title);
  if (!priorPlace) return false;
  const a = normalizePlaceKeyword(locationQuery);
  const b = normalizePlaceKeyword(priorPlace);
  if (a === b) return true;
  const priorName = prior.resolvedLocation?.name;
  if (priorName && (priorName.includes(a) || a.includes(priorName))) return true;
  return false;
}

/**
 * 找到时长应绑定的活动下标。
 * 策略：从评论中提取时长短语前的动作词（如「看三个小时」→「看」），
 * 在事件标题中寻找包含该动作词（或其同义）的活动；找不到则回退到最后一个活动。
 */
function findDurationTargetIndex(events: ResolvedTripEvent[], commentText: string): number {
  const lastIndex = events.length - 1;
  if (events.length === 0) return 0;

  // 提取时长短语前的动作词：匹配「(动作)(数字/量词)小时/分钟/半小时」
  const actionMatch = commentText.match(
    /([\u4e00-\u9fa5]{1,4}?)(?:[一二两三四五六七八九十\d]+|一个|两个|半)?\s*(?:个)?\s*(?:小时|个小时|分钟|半小时)/,
  );
  const action = actionMatch ? actionMatch[1] : undefined;
  if (!action) return lastIndex;

  // 在事件标题中寻找包含该动作词（或其语义近义词）的活动
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const title = events[i].title;
    if (title.includes(action)) return i;
    // 语义近义词：看/读/阅读/书 → 看书活动
    if (/(看|读|阅读|书)/.test(action) && /(看|读|阅读|书)/.test(title)) return i;
    if (/(吃|餐|饭|菜)/.test(action) && /(吃|餐|饭|菜)/.test(title)) return i;
    if (/(打|运动|球)/.test(action) && /(打|运动|球)/.test(title)) return i;
  }
  return lastIndex;
}

/** 常见菜系/餐饮关键词表（通用意图表，禁止对单一菜系做 special-case 分支） */
const CUISINE_KEYWORDS = [
  '越南菜', '泰国菜', '粤菜', '广式', '川菜', '湘菜', '赣菜', '江浙菜',
  '日料', '日本料理', '韩料', '寿司', '刺身', '火锅', '打边炉', '烧烤',
  '烤肉', '咖啡', '甜品', '甜点', '素食', '素菜', '西餐', '披萨', '比萨',
  '汉堡', '炸鸡', '米粉', '河粉', '肠粉', '牛肉面', '拉面', '面馆', '早茶',
  '点心', '海鲜', '自助餐', '大排档', '夜宵', '下午茶',
];

/** 是否为餐饮类标题：
 *   - 含 吃/喝/餐/饭/菜（吃越南菜、晚餐、下午喝咖啡）
 *   - 或标题本身就是菜系/餐饮词（咖啡、火锅、甜品）
 */
export function isMealTitle(title: string): boolean {
  if (/吃|喝|餐|饭|菜/.test(title)) return true;
  return CUISINE_KEYWORDS.includes(title);
}

/** 是否为移动/交通类标题（「前往X」「坐地铁X」等，不做 POI 解析） */
function isTransportTitle(title: string): boolean {
  return /^(前往|去往|坐|乘|搭|打车|地铁|公交|高铁|火车|飞机|导航|从)/.test(title);
}

/**
 * 通用地点短语提取：从活动标题中剥离动作词后取出地点短语。
 *
 * 例：
 *   「广州图书馆看书」→「广州图书馆」
 *   「参观省博物馆」→「省博物馆」
 *   「去广州塔」→「广州塔」
 *   「在天河体育中心打羽毛球」→「天河体育中心」
 *   「逛K11」→「K11」
 *   「去酒店休息」→「酒店」
 *   「去完广图吃泰国菜」→「广图」（餐饮标题自带地点 anchor，供 nearby 搜索）
 *   「北京路吃饭」→「北京路」；「去天河城吃饭」→「天河城」（地点 + 吃/饭 前缀）
 *
 * 规则：
 *   - 餐饮标题提取「去完X吃…」或「地点+吃/饭/菜」中的地点作为 anchor；
 *     纯餐饮词（吃越南菜 / 晚餐 / 咖啡）无地点前缀 → undefined
 *   - 剥离前导时间词（晚上/中午…）与泛化短语（找一家/附近/随便…），
 *     并拒绝通用餐饮词（餐厅/饭馆/店…）作为地点，避免把非具体地点当地点锚点
 *   - 交通类标题不解析地点（移动不是实体地点）
 *   - 剥离前缀动词（去/参观/在/到…）与后缀活动词（看书/打羽毛球…）
 *   - 只接受 2-12 位中文/字母数字短语，其余返回 undefined
 */
export function extractPlaceQuery(title: string): string | undefined {
  if (!title) return undefined;
  if (isTransportTitle(title)) return undefined;
  if (isMealTitle(title)) {
    // 餐饮标题自身携带地点 anchor：
    //   「去完广图吃泰国菜」→「广图」（既有模式）
    //   「北京路吃饭」→「北京路」；「去天河城吃饭」→「天河城」（地点 + 吃/饭 前缀）
    const afterPattern = title.match(/去完\s*([\u4e00-\u9fa5A-Za-z0-9]{2,8}?)(?:后|之后|再|就|直接)?(?:吃|喝|来杯|点)/);
    if (afterPattern) return afterPattern[1];

    // 通用「地点 + 吃/饭/菜」模式：剥离前导动词/时间词/泛化短语后，
    // 取餐饮动词前的文本作为地点锚点。
    // 这样「北京路吃饭」→「北京路」，餐厅 nearby 搜索会以北京路为中心，
    // 而不是回退到上一活动（越秀公园）坐标。
    let t = title.trim();
    t = t.replace(/^(?:前往|去往|去|到|在|去)/, '');
    // 剥离时间词与泛化短语（「晚上附近吃火锅」「找一家餐厅吃饭」→ 无具体地点，回退上一活动）
    t = t.replace(/^(?:早上|上午|中午|下午|晚上|清晨|深夜|凌晨|白天|傍晚|夜里|之后|随后|然后|接着|帮我|帮我找|找一家|找家|找个|找|附近|周边|随便|就近|就近找)/, '');
    const mealVerbIndex = t.search(/(?:吃|喝|来杯|点|饭|菜)/);
    if (mealVerbIndex > 0) {
      let place = t.slice(0, mealVerbIndex).trim();
      // 剥离「附近/周边/旁边」等方位后缀，保留具体地点（「越秀公园附近吃饭」→「越秀公园」）
      place = place.replace(/(?:附近|周边|旁边|左右|那边|这边)$/, '');
      // 拒绝通用餐饮词（「餐厅/饭馆/店」等无具体指向），只接受具体地点名
      if (
        /^[\u4e00-\u9fa5A-Za-z0-9]{2,12}$/.test(place) &&
        !/^(?:餐厅|饭馆|馆子|饭店|酒楼|菜馆|快餐|小吃|美食|地方|咖啡|甜品|火锅|烧烤|日料|西餐|中餐|早餐|午餐|晚餐|夜宵|宵夜|饭|菜|餐|店)$/.test(place)
      ) {
        return place;
      }
    }
    return undefined;
  }

  let t = title.trim();
  // 剥离前缀动词（含复合前缀）
  t = t.replace(/^(?:去参观|去游览|去游玩|去完|前往|参观|游览|游玩|体验|逛|看|到|在|去|直接去)/, '');
  // 在第一个动作动词处截断（「广州图书馆看书」→「广州图书馆」；「广州塔看夜景」→「广州塔」）
  const verbIndex = t.search(
    /(?:办理入住|入住|住宿|休息|看|读|玩|打|吃|喝|买|购物|逛街|参观|游览|体验|听|唱|跳|拍|打卡|运动|游泳|跑步|骑行|散步|爬山|放风筝|候车|乘车|换乘)/,
  );
  if (verbIndex > 0) t = t.slice(0, verbIndex);

  t = t.trim();
  // 只接受 2-12 位中文/字母数字短语（「书」「塔」等单字太弱，交给 POI 搜索反而引入噪声）
  if (!/^[\u4e00-\u9fa5A-Za-z0-9]{2,12}$/.test(t)) return undefined;
  return t;
}

/**
 * 通用餐饮关键词提取：把「吃越南菜」「吃个火锅」「附近吃饭」「找个餐厅」等
 * 统一抽取为单个 foodKeyword 交给腾讯 nearby 搜索。
 *
 * 例：
 *   「吃越南菜」→「越南菜」
 *   「吃泰国菜」→「泰国菜」（与越南菜同一通用路径，无 special-case）
 *   「吃个火锅」→「火锅」
 *   「吃粤菜」→「粤菜」
 *   「去完省博吃越南菜」→「越南菜」
 *   「吃饭」/「附近吃饭」/「找个餐厅」→「餐厅」
 */
export function extractFoodKeyword(title: string): string | undefined {
  if (!title) return undefined;
  // 1. 「吃X」直接捕获（吃个/吃点/吃顿/吃一）
  const m = title.match(/吃(?:个|点|顿|一)?([\u4e00-\u9fa5A-Za-z0-9]{1,8})/);
  if (m) {
    const kw = m[1].trim();
    if (kw === '饭' || kw === '餐' || kw === '东西' || kw === '的') return '餐厅';
    if (/^[\u4e00-\u9fa5A-Za-z0-9]+$/.test(kw)) return kw;
  }
  // 2. 标题包含已知菜系词 → 返回该菜系词
  for (const kw of CUISINE_KEYWORDS) {
    if (title.includes(kw)) return kw;
  }
  // 3. 含 吃/餐/饭 的通用意图 → 通用「餐厅」
  if (/吃|餐|饭/.test(title)) return '餐厅';
  return undefined;
}
