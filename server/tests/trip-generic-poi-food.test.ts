// AI Trip Pipeline 通用 POI / 餐饮关键词 / 评论驱动先后关系测试。
//
// 覆盖：
//   B. 通用地点短语提取（任意需要实体地点的活动都尝试 POI 解析）
//   E. 通用餐饮关键词（越南菜 / 泰国菜 / 粤菜 / 火锅 / 咖啡 … 同一通用路径）
//   G. 「参观省博后吃越南菜」→ afterActivityId = 省博事件，anchor = 广东省博物馆真实坐标
//   F. truth-preserving：候选名只来自 Tencent response；无 rating 保持 undefined
//   H. 腾讯返回 0 / 抛错 → 无 mock restaurant（蔡澜Pho 等 fixture 绝不进入运行时）
//
// 全部使用可编程 Tencent LBS stub，不依赖真实网络。

import assert from 'assert';
import { record } from './run-tests';
import {
  extractPlaceQuery,
  extractFoodKeyword,
  postProcessTripPlan,
} from '../src/services/trip-plan-post-processor';
import { resolveSequenceConstraints } from '../src/services/trip-sequence-resolution';
import {
  PlaceCandidate,
  POISearchOutcome,
  TencentLBSService,
} from '../src/services/tencent-lbs-service';
import { TripPlan, TripPlanEvent } from '../src/types/trip-plan';

const TZ = 'Asia/Shanghai';

function makePlan(events: TripPlanEvent[]): TripPlan {
  return {
    id: 'plan_trip_T_v1',
    tripId: 'trip_T',
    version: 1,
    events,
    satisfiedConstraintCount: 0,
    totalConstraintCount: 0,
    conflicts: [],
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

function makeEvent(overrides: Partial<TripPlanEvent> = {}): TripPlanEvent {
  return {
    id: 'event_1',
    type: 'OTHER',
    title: '广州图书馆看书',
    time: { start: '2026-09-10T10:00:00+08:00', timezone: TZ },
    ...overrides,
  };
}

function tencentCandidate(name: string, distance?: number, address?: string): PlaceCandidate {
  return {
    provider: 'tencent',
    providerPoiId: `poi_${name}`,
    name,
    latitude: 23.13,
    longitude: 113.32,
    ...(address ? { address } : {}),
    ...(distance !== undefined ? { distanceMeters: distance } : {}),
  };
}

/** 可编程 LBS stub：记录 searchPOI / searchNearby 调用参数并返回预置结果 */
function stubLBS(options: {
  poiByQuery?: Record<string, POISearchOutcome>;
  nearby?: POISearchOutcome;
  nearbyKeyword?: string[];
  throwOn?: 'poi' | 'nearby';
}): TencentLBSService & { poiQueries: string[]; nearbyQueries: { keyword: string; lat: number; lng: number }[] } {
  const service = new TencentLBSService({ key: 'test-key' }) as TencentLBSService & {
    poiQueries: string[];
    nearbyQueries: { keyword: string; lat: number; lng: number }[];
  };
  service.poiQueries = [];
  service.nearbyQueries = [];
  (service as unknown as { searchPOI: (q: string, city: string) => Promise<POISearchOutcome> }).searchPOI = async (
    query: string,
  ) => {
    service.poiQueries.push(query);
    if (options.throwOn === 'poi') return { status: 'POI_SEARCH_UNAVAILABLE', candidates: [] };
    const outcome = options.poiByQuery?.[query];
    return outcome ?? { status: 'POI_NOT_FOUND', candidates: [] };
  };
  (service as unknown as { searchNearby: (k: string, lat: number, lng: number) => Promise<POISearchOutcome> }).searchNearby =
    async (keyword: string, latitude: number, longitude: number) => {
      service.nearbyQueries.push({ keyword, lat: latitude, lng: longitude });
      if (options.throwOn === 'nearby') return { status: 'POI_SEARCH_UNAVAILABLE', candidates: [] };
      if (options.nearbyKeyword && !options.nearbyKeyword.includes(keyword)) {
        return { status: 'POI_NOT_FOUND', candidates: [] };
      }
      return options.nearby ?? { status: 'POI_NOT_FOUND', candidates: [] };
    };
  return service;
}

const DEFAULT_TIME_RANGE = { start: '2026-09-10T09:00:00+08:00', timezone: TZ };

export async function runGenericPoiFoodTests(): Promise<void> {
  // ---------- B. 通用地点短语提取 ----------
  await record('B. 「广州图书馆看书」→ placeQuery「广州图书馆」', () => {
    assert.strictEqual(extractPlaceQuery('广州图书馆看书'), '广州图书馆');
  });

  await record('B. 「参观省博物馆」→ placeQuery「省博物馆」', () => {
    assert.strictEqual(extractPlaceQuery('参观省博物馆'), '省博物馆');
  });

  await record('B. 「去广州塔」→ placeQuery「广州塔」', () => {
    assert.strictEqual(extractPlaceQuery('去广州塔'), '广州塔');
  });

  await record('B. 「在天河体育中心打羽毛球」→ placeQuery「天河体育中心」', () => {
    assert.strictEqual(extractPlaceQuery('在天河体育中心打羽毛球'), '天河体育中心');
  });

  await record('B. 餐饮标题不做 POI 解析（吃越南菜 / 晚餐 / 咖啡）', () => {
    assert.strictEqual(extractPlaceQuery('吃越南菜'), undefined);
    assert.strictEqual(extractPlaceQuery('晚餐'), undefined);
    assert.strictEqual(extractPlaceQuery('咖啡'), undefined);
  });

  await record('B. 「北京路吃饭」→ placeQuery「北京路」（地点+吃 前缀，不丢 anchor）', () => {
    assert.strictEqual(extractPlaceQuery('北京路吃饭'), '北京路');
  });

  await record('B. 「去天河城吃饭」→ placeQuery「天河城」（通用，非 hardcode 北京路）', () => {
    assert.strictEqual(extractPlaceQuery('去天河城吃饭'), '天河城');
  });

  await record('B. 「越秀公园附近吃饭」→ placeQuery「越秀公园」（剥离方位后缀）', () => {
    assert.strictEqual(extractPlaceQuery('越秀公园附近吃饭'), '越秀公园');
  });

  await record('B. 「去完广图吃泰国菜」→ placeQuery「广图」（既有模式不受影响）', () => {
    assert.strictEqual(extractPlaceQuery('去完广图吃泰国菜'), '广图');
  });

  await record('B. 交通标题不做 POI 解析（前往越秀）', () => {
    assert.strictEqual(extractPlaceQuery('前往越秀'), undefined);
  });

  // ---------- E. 通用餐饮关键词 ----------
  await record('E. 「吃越南菜」→ foodKeyword「越南菜」', () => {
    assert.strictEqual(extractFoodKeyword('吃越南菜'), '越南菜');
  });

  await record('E. 「吃泰国菜」→ foodKeyword「泰国菜」（与越南菜同一通用路径）', () => {
    assert.strictEqual(extractFoodKeyword('吃泰国菜'), '泰国菜');
  });

  await record('E. 「吃粤菜」/「吃个火锅」/「来杯咖啡」→ 各自菜系词，无 Thai special-case', () => {
    assert.strictEqual(extractFoodKeyword('吃粤菜'), '粤菜');
    assert.strictEqual(extractFoodKeyword('吃个火锅'), '火锅');
    assert.strictEqual(extractFoodKeyword('来杯咖啡'), '咖啡');
    assert.strictEqual(extractFoodKeyword('吃烧烤'), '烧烤');
    assert.strictEqual(extractFoodKeyword('吃日料'), '日料');
    assert.strictEqual(extractFoodKeyword('吃甜品'), '甜品');
  });

  await record('E. 「去完省博吃越南菜」→ foodKeyword「越南菜」', () => {
    assert.strictEqual(extractFoodKeyword('去完省博吃越南菜'), '越南菜');
  });

  await record('E. 通用吃饭意图 → 「餐厅」', () => {
    assert.strictEqual(extractFoodKeyword('吃饭'), '餐厅');
    assert.strictEqual(extractFoodKeyword('附近吃饭'), '餐厅');
    assert.strictEqual(extractFoodKeyword('找个餐厅'), '餐厅');
  });

  // ---------- H.1-3. 通用 POI 解析请求 + 真实地址 ----------
  await record('H.4 「广州图书馆看书」→ 触发 POI 解析且 resolved location 有地址', async () => {
    const lbs = stubLBS({
      poiByQuery: {
        广州图书馆: {
          status: 'FOUND',
          candidates: [tencentCandidate('广州图书馆', undefined, '广东省广州市天河区珠江东路4号')],
        },
      },
    });
    const result = await postProcessTripPlan(
      {
        plan: makePlan([makeEvent({ id: 'event_1', title: '广州图书馆看书' })]),
        timeRange: DEFAULT_TIME_RANGE,
        city: '广州市',
      },
      lbs,
    );
    assert.deepStrictEqual(lbs.poiQueries, ['广州图书馆'], '必须发起通用地点 POI 解析');
    const loc = result.plan.events[0].location;
    assert.strictEqual(loc?.name, '广州图书馆');
    assert.ok(loc?.address, 'resolved location 必须有地址');
    assert.strictEqual(loc?.providerRefs?.[0]?.provider, 'tencent');
  });

  await record('H.5 「参观省博物馆」+ city=广州 → 解析到广东省博物馆且地址非空', async () => {
    const lbs = stubLBS({
      poiByQuery: {
        省博物馆: {
          status: 'FOUND',
          candidates: [tencentCandidate('广东省博物馆', undefined, '广东省广州市天河区珠江东路2号')],
        },
      },
    });
    const result = await postProcessTripPlan(
      {
        plan: makePlan([makeEvent({ id: 'event_1', title: '参观省博物馆', time: { start: '2026-09-10T13:00:00+08:00', timezone: TZ } })]),
        timeRange: DEFAULT_TIME_RANGE,
        city: '广州市',
      },
      lbs,
    );
    assert.deepStrictEqual(lbs.poiQueries, ['省博物馆'], '「省博/省博物馆」走腾讯搜索而非硬编码 alias');
    const loc = result.plan.events[0].location;
    assert.strictEqual(loc?.name, '广东省博物馆');
    assert.ok(loc?.address, '地址非空');
    assert.strictEqual(loc?.providerRefs?.[0]?.provider, 'tencent');
  });

  // ---------- E/G. 餐饮 nearby 搜索泛化 ----------
  await record('G. 「吃越南菜」→ nearby keyword=越南菜（通用路径）', async () => {
    const lbs = stubLBS({
      poiByQuery: {
        广州图书馆: {
          status: 'FOUND',
          candidates: [tencentCandidate('广州图书馆', undefined, '广东省广州市天河区珠江东路4号')],
        },
        省博物馆: {
          status: 'FOUND',
          candidates: [tencentCandidate('广东省博物馆', undefined, '广东省广州市天河区珠江东路2号')],
        },
      },
      nearby: {
        status: 'FOUND',
        candidates: [tencentCandidate('越芽越南餐厅', 800, '广东省广州市越秀区建设大马路18号')],
      },
      nearbyKeyword: ['越南菜'],
    });
    const result = await postProcessTripPlan(
      {
        plan: makePlan([
          makeEvent({ id: 'event_1', title: '广州图书馆看书', time: { start: '2026-09-10T10:00:00+08:00', timezone: TZ } }),
          makeEvent({ id: 'event_2', type: 'OTHER', title: '参观省博物馆', time: { start: '2026-09-10T13:00:00+08:00', timezone: TZ } }),
          makeEvent({ id: 'event_3', type: 'DINING', title: '吃越南菜', time: { start: '2026-09-10T14:30:00+08:00', timezone: TZ } }),
        ]),
        timeRange: DEFAULT_TIME_RANGE,
        city: '广州市',
        commentText: '10点去广州图书馆看书3小时，13点参观省博，参观省博后吃越南菜。',
      },
      lbs,
    );
    // 评论驱动先后关系：吃越南菜 → 省博
    assert.strictEqual(
      result.plan.events[2].sequenceConstraint?.afterActivityId,
      'event_2',
      '吃越南菜必须链接到省博事件',
    );
    assert.strictEqual(
      result.plan.events[2].sequenceConstraint?.locationConstraint,
      'near_previous_activity',
    );
    // nearby 搜索以省博真实坐标 + 越南菜 keyword 执行
    assert.strictEqual(lbs.nearbyQueries.length, 1);
    assert.strictEqual(lbs.nearbyQueries[0].keyword, '越南菜');
    assert.strictEqual(lbs.nearbyQueries[0].lat, 23.13, 'anchor 必须是省博真实坐标');
    // 餐厅名只来自腾讯 response
    assert.strictEqual(result.plan.events[2].restaurant?.name, '越芽越南餐厅');
    assert.strictEqual(result.plan.events[2].restaurant?.providerRefs?.[0]?.provider, 'tencent');
    // 省博与图书馆都解析出真实 POI + 地址
    assert.strictEqual(result.plan.events[1].location?.name, '广东省博物馆');
    assert.ok(result.plan.events[1].location?.address);
    assert.strictEqual(result.plan.events[0].location?.name, '广州图书馆');
    assert.ok(result.plan.events[0].location?.address);
  });

  await record('G. 「之后附近吃越南菜」→ anchor 为紧邻前置活动（省博）而非图书馆', async () => {
    const lbs = stubLBS({
      poiByQuery: {
        广州图书馆: {
          status: 'FOUND',
          candidates: [tencentCandidate('广州图书馆', undefined, '广东省广州市天河区珠江东路4号')],
        },
        省博物馆: {
          status: 'FOUND',
          candidates: [tencentCandidate('广东省博物馆', undefined, '广东省广州市天河区珠江东路2号')],
        },
      },
      nearby: { status: 'FOUND', candidates: [tencentCandidate('越芽越南餐厅', 800)] },
      nearbyKeyword: ['越南菜'],
    });
    const result = await postProcessTripPlan(
      {
        plan: makePlan([
          makeEvent({ id: 'event_1', title: '广州图书馆看书', time: { start: '2026-09-10T10:00:00+08:00', timezone: TZ } }),
          makeEvent({ id: 'event_2', type: 'OTHER', title: '参观省博物馆', time: { start: '2026-09-10T13:00:00+08:00', timezone: TZ } }),
          makeEvent({ id: 'event_3', type: 'DINING', title: '吃越南菜', time: { start: '2026-09-10T14:30:00+08:00', timezone: TZ } }),
        ]),
        timeRange: DEFAULT_TIME_RANGE,
        city: '广州市',
        commentText: '先逛图书馆，再去省博，之后附近吃越南菜。',
      },
      lbs,
    );
    assert.strictEqual(result.plan.events[2].sequenceConstraint?.afterActivityId, 'event_2');
    assert.strictEqual(lbs.nearbyQueries[0].lat, 23.13, 'anchor 必须是省博真实坐标，不是图书馆');
  });

  // ---------- F. truth-preserving ----------
  await record('F. Tencent 越南菜 response 无 rating → restaurant.rating undefined', async () => {
    const lbs = stubLBS({
      poiByQuery: {
        省博: { status: 'FOUND', candidates: [tencentCandidate('广东省博物馆', undefined, '广东省广州市天河区珠江东路2号')] },
      },
      nearby: { status: 'FOUND', candidates: [tencentCandidate('越芽越南餐厅', 500)] },
      nearbyKeyword: ['越南菜'],
    });
    const result = await postProcessTripPlan(
      {
        plan: makePlan([
          makeEvent({ id: 'event_1', type: 'DINING', title: '去完省博吃越南菜', time: { start: '2026-09-10T13:00:00+08:00', timezone: TZ } }),
        ]),
        timeRange: DEFAULT_TIME_RANGE,
        city: '广州市',
        commentText: '去完省博后吃越南菜',
      },
      lbs,
    );
    assert.strictEqual(result.plan.events[0].restaurant?.name, '越芽越南餐厅');
    assert.strictEqual(result.plan.events[0].restaurant?.rating, undefined, '不得伪造 rating');
    assert.strictEqual(result.plan.events[0].restaurant?.averagePrice, undefined, '不得伪造 avgPrice');
  });

  await record('F. 腾讯返回 0 候选 → 无蔡澜Pho、无任何 fallback restaurant', async () => {
    const lbs = stubLBS({
      poiByQuery: {
        省博物馆: { status: 'FOUND', candidates: [tencentCandidate('广东省博物馆', undefined, '广东省广州市天河区珠江东路2号')] },
      },
      nearby: { status: 'POI_NOT_FOUND', candidates: [] },
    });
    const result = await postProcessTripPlan(
      {
        plan: makePlan([
          makeEvent({ id: 'event_1', type: 'DINING', title: '吃越南菜', time: { start: '2026-09-10T13:00:00+08:00', timezone: TZ } }),
        ]),
        timeRange: DEFAULT_TIME_RANGE,
        city: '广州市',
        commentText: '参观省博后吃越南菜',
      },
      lbs,
    );
    assert.strictEqual(result.plan.events[0].restaurant, undefined, '腾讯 0 结果时 restaurant 必须为 undefined');
  });

  await record('F. 腾讯抛错 → 无 mock restaurant', async () => {
    const lbs = stubLBS({ throwOn: 'nearby' });
    const result = await postProcessTripPlan(
      {
        plan: makePlan([
          makeEvent({ id: 'event_1', type: 'DINING', title: '吃泰国菜', time: { start: '2026-09-10T13:00:00+08:00', timezone: TZ } }),
        ]),
        timeRange: DEFAULT_TIME_RANGE,
        city: '广州市',
      },
      lbs,
    );
    assert.strictEqual(result.plan.events[0].restaurant, undefined);
  });

  // ---------- 评论驱动先后关系（单元） ----------
  await record('G. 「参观省博后吃越南菜」→ afterActivityId = 省博事件', () => {
    const events = [
      makeEvent({ id: 'event_1', title: '广州图书馆看书' }),
      makeEvent({ id: 'event_2', type: 'OTHER', title: '参观省博物馆' }),
      makeEvent({ id: 'event_3', type: 'DINING', title: '吃越南菜' }),
    ];
    const resolved = resolveSequenceConstraints(events, '参观省博后吃越南菜');
    assert.strictEqual(resolved[2].sequenceConstraint?.afterActivityId, 'event_2');
    assert.strictEqual(resolved[2].sequenceConstraint?.locationConstraint, 'near_previous_activity');
    assert.strictEqual(resolved[1].sequenceConstraint, undefined, '省博自身无先后关系');
  });

  // ---------- 明确地点锚点 → 餐厅 nearby 搜索中心（本次修复核心） ----------
  await record('ANCHOR A. 「去北京路吃饭」→ 搜索中心来自北京路坐标，不是越秀公园', async () => {
    const lbs = stubLBS({
      poiByQuery: {
        北京路: { status: 'FOUND', candidates: [tencentCandidate('北京路步行街', undefined, '广东省广州市越秀区北京路')] },
      },
      nearby: { status: 'FOUND', candidates: [tencentCandidate('北京路附近餐厅', 200)] },
      nearbyKeyword: ['餐厅'],
    });
    const result = await postProcessTripPlan(
      {
        plan: makePlan([
          makeEvent({ id: 'event_1', type: 'DINING', title: '去北京路吃饭', time: { start: '2026-09-10T13:00:00+08:00', timezone: TZ } }),
        ]),
        timeRange: DEFAULT_TIME_RANGE,
        city: '广州市',
        commentText: '去北京路吃饭',
      },
      lbs,
    );
    // 必须先解析北京路坐标，再以其为 nearby 中心
    assert.ok(lbs.poiQueries.includes('北京路'), '必须先用 searchPOI 解析北京路');
    assert.strictEqual(lbs.nearbyQueries.length, 1);
    assert.strictEqual(lbs.nearbyQueries[0].lat, 23.13, 'nearby 中心必须是北京路坐标');
    assert.strictEqual(lbs.nearbyQueries[0].lng, 113.32, 'nearby 中心必须是北京路坐标');
    assert.strictEqual(result.plan.events[0].restaurant?.name, '北京路附近餐厅');
  });

  await record('A. 「北京路吃饭」在越秀公园之后 → 搜索中心仍是北京路，不继承越秀公园', async () => {
    const lbs = stubLBS({
      poiByQuery: {
        北京路: { status: 'FOUND', candidates: [placeAt('北京路步行街', 23.12, 113.28)] },
      },
      nearby: { status: 'FOUND', candidates: [placeAt('北京路附近餐厅', 23.12, 113.28)] },
      nearbyKeyword: ['餐厅'],
    });
    const result = await postProcessTripPlan(
      {
        plan: makePlan([
          makeEvent({ id: 'event_1', type: 'OTHER', title: '广州图书馆看书', time: { start: '2026-09-10T10:00:00+08:00', timezone: TZ } }),
          makeEvent({ id: 'event_2', type: 'OTHER', title: '越秀公园', time: { start: '2026-09-10T14:00:00+08:00', timezone: TZ } }),
          makeEvent({ id: 'event_3', type: 'DINING', title: '去北京路吃饭', time: { start: '2026-09-10T18:00:00+08:00', timezone: TZ } }),
        ]),
        timeRange: DEFAULT_TIME_RANGE,
        city: '广州市',
        commentText: '去北京路吃饭',
      },
      lbs,
    );
    // 越秀公园未解析出坐标（stub 未提供），但北京路必须被解析并作为 nearby 中心
    assert.ok(lbs.poiQueries.includes('北京路'), '必须解析北京路');
    assert.strictEqual(lbs.nearbyQueries[0].lat, 23.12, 'nearby 中心必须是北京路坐标，不是越秀公园');
    assert.strictEqual(lbs.nearbyQueries[0].lng, 113.28);
    assert.strictEqual(result.plan.events[2].restaurant?.name, '北京路附近餐厅');
  });

  await record('C. 无明确地点「找一家餐厅吃饭」→ 允许回退上一活动附近', async () => {
    const lbs = stubLBS({
      poiByQuery: {
        越秀公园: { status: 'FOUND', candidates: [placeAt('越秀公园', 23.14, 113.26)] },
      },
      nearby: { status: 'FOUND', candidates: [placeAt('越秀公园附近餐厅', 23.14, 113.26)] },
    });
    const result = await postProcessTripPlan(
      {
        plan: makePlan([
          makeEvent({ id: 'event_1', type: 'OTHER', title: '越秀公园', time: { start: '2026-09-10T14:00:00+08:00', timezone: TZ } }),
          makeEvent({ id: 'event_2', type: 'DINING', title: '找一家餐厅吃饭', time: { start: '2026-09-10T18:00:00+08:00', timezone: TZ } }),
        ]),
        timeRange: DEFAULT_TIME_RANGE,
        city: '广州市',
        commentText: '找一家餐厅吃饭',
      },
      lbs,
    );
    // 无明确地点 → 允许回退上一活动（越秀公园）作为 nearby 中心
    assert.strictEqual(lbs.nearbyQueries[0].lat, 23.14, '无明确地点时回退上一活动坐标');
    assert.strictEqual(lbs.nearbyQueries[0].lng, 113.26);
    assert.strictEqual(result.plan.events[1].restaurant?.name, '越秀公园附近餐厅');
  });

  await record('D. 「去天河城吃饭」→ anchor 为天河城（非 hardcode 北京路）', () => {
    assert.strictEqual(extractPlaceQuery('去天河城吃饭'), '天河城');
  });
}

/** 构造带指定坐标的候选 */
function placeAt(name: string, latitude: number, longitude: number): PlaceCandidate {
  return { provider: 'tencent', providerPoiId: `poi_${name}`, name, latitude, longitude };
}
