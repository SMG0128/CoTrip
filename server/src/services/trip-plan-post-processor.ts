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
} from './trip-sequence-resolution';
import { PlaceCandidate, TencentLBSService } from './tencent-lbs-service';
import { rankPlaceCandidates, RankedPlaceCandidate } from './place-candidate-ranker';

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
  /** 附近餐厅候选（全部来自腾讯 API，truth-preserving） */
  restaurantCandidates?: RankedPlaceCandidate[];
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
    const nextStart = new Date(priorEnd + realTravelMs);
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

  // 3. 先后关系（D）
  events = resolveSequenceConstraints(events) as ResolvedTripEvent[];

  // 4. 时间不重叠（J）：按先后关系调整后续活动时间。
  //    无真实路线 duration 时 start = previous.end（不伪造 travel）；真实 route duration 由外部注入。
  events = applySequenceTimes(events);

  // 5. POI 解析（E/F/G/H/I）
  if (lbs) {
    events = await resolvePOIs(events, city, lbs, input);
  }

  const plan: TripPlan = {
    ...input.plan,
    events: events.map((event) => {
      const { sequenceConstraint, resolvedLocation, restaurantCandidates, locationStatus, ...rest } = event;
      const planEvent: TripPlanEvent = {
        ...rest,
        ...(sequenceConstraint ? { sequenceConstraint } : {}),
      };
      // Provider 验证后的真实地点写入 event.location（前端可直接展示）
      if (resolvedLocation) {
        planEvent.location = resolvedLocation;
      }
      // 附近餐厅 top 候选写入 event.restaurant（前端「当前首选」展示）
      if (restaurantCandidates && restaurantCandidates.length > 0) {
        const top = restaurantCandidates[0];
        const providerRefs = [{ provider: 'tencent' as const, externalId: top.providerPoiId }];
        planEvent.restaurant = {
          id: top.providerPoiId,
          name: top.name,
          location: {
            id: top.providerPoiId,
            name: top.name,
            latitude: top.latitude,
            longitude: top.longitude,
            ...(top.address ? { address: top.address } : {}),
            providerRefs,
          },
          ...(typeof top.distanceMeters === 'number' ? { distanceMeters: top.distanceMeters } : {}),
          // truth-preserving：仅当腾讯真实返回 rating / avgPrice 时才写入
          ...(typeof top.rating === 'number' ? { rating: { score: top.rating } } : {}),
          ...(typeof top.avgPrice === 'number'
            ? { averagePrice: { amount: top.avgPrice, currency: 'CNY', unit: 'per_person' } }
            : {}),
          providerRefs,
        };
      }
      return planEvent;
    }),
  };

  return { plan, events };
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
  // 若活动有先后关系（near_previous_activity），优先复用前置活动的真实坐标作为锚点，
  // 而不是对「去完广图吃泰国菜」这类标题做一次新的 POI 解析。
  const seq = event.sequenceConstraint;
  const prior = seq
    ? resolvedSoFar.find((e) => e.id === seq.afterActivityId)
    : undefined;
  const priorLocation = prior?.resolvedLocation;

  // 从标题提取地点关键词（如「去广州图书馆看书」→「广州图书馆」）
  const locationQuery = extractLocationQuery(event.title);

  // 锚点坐标：优先用前置活动真实坐标；否则用本活动 POI 解析结果
  let resolvedLat: number | undefined;
  let resolvedLng: number | undefined;
  let resolvedLocation: ResolvedTripEvent['resolvedLocation'];
  let locationStatus: ResolvedTripEvent['locationStatus'] = 'unresolved';

  if (prior && priorLocation) {
    // 复用前置活动真实坐标（near_previous_activity）
    resolvedLat = priorLocation.latitude;
    resolvedLng = priorLocation.longitude;
    resolvedLocation = priorLocation;
    locationStatus = 'resolved';
  } else if (locationQuery) {
    const poiOutcome = await lbs.searchPOI(locationQuery, city);
    if (poiOutcome.status === 'FOUND' && poiOutcome.candidates.length > 0) {
      const top = poiOutcome.candidates[0];
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
    } else {
      locationStatus =
        poiOutcome.status === 'POI_SEARCH_UNAVAILABLE' ? 'search_unavailable' : 'unresolved';
    }
  }

  const resolvedEvent: ResolvedTripEvent = {
    ...event,
    ...(resolvedLocation ? { resolvedLocation } : {}),
    locationStatus,
  };

  // 若活动是餐饮（DINING）或标题含「吃/菜/餐」，则搜索附近餐厅
  if (event.type === 'DINING' || /吃|菜|餐|饭/.test(event.title)) {
    const keyword = extractDiningKeyword(event.title) || '餐厅';
    if (resolvedLat !== undefined && resolvedLng !== undefined) {
      const nearby = await lbs.searchNearby(keyword, resolvedLat, resolvedLng);
      if (nearby.status === 'FOUND') {
        resolvedEvent.restaurantCandidates = rankPlaceCandidates(
          nearby.candidates,
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

/** 从活动标题提取地点关键词（如「去广州图书馆看书」→「广州图书馆」） */
function extractLocationQuery(title: string): string | undefined {
  const m = title.match(/去\s*([\u4e00-\u9fa5A-Za-z0-9]{2,})/);
  return m ? m[1] : undefined;
}

/** 从活动标题提取餐饮关键词（如「吃泰国菜」→「泰国菜」） */
function extractDiningKeyword(title: string): string | undefined {
  const m = title.match(/吃\s*([\u4e00-\u9fa5A-Za-z0-9]+)/);
  return m ? m[1] : undefined;
}