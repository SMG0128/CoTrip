// trip-meal-resolution.test.ts
// 通用真实餐厅解析测试（A/B/P 节）。
//
// 覆盖：
//   A. 「附近粤菜」没有具体餐厅的问题：任何 meal intent + foodKeyword + 可解析 anchor
//      → Tencent nearby → 确定性排序 → top 写入 event.restaurant + 其余写入 restaurantCandidates
//   B. anchor 优先级：明确地点 > sequenceConstraint 前置 > 回看最近已解析前置活动
//   P. Tencent 返回 A/B 两候选 → restaurant = 确定性 top（A），alternatives = 其余真实候选
//   P. Tencent 返回 0 → restaurant undefined，无 mock
//
// 全部使用可编程 Tencent LBS stub，不依赖真实网络；不针对具体城市写 special-case。

import assert from 'assert';
import { record } from './run-tests';
import { postProcessTripPlan } from '../src/services/trip-plan-post-processor';
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
    title: '越秀公园',
    time: { start: '2026-09-10T10:00:00+08:00', timezone: TZ },
    ...overrides,
  };
}

function tencentCandidate(name: string, opts: { distance?: number; address?: string; lat?: number; lng?: number } = {}): PlaceCandidate {
  return {
    provider: 'tencent',
    providerPoiId: `poi_${name}`,
    name,
    latitude: opts.lat ?? 23.13,
    longitude: opts.lng ?? 113.32,
    ...(opts.address ? { address: opts.address } : {}),
    ...(opts.distance !== undefined ? { distanceMeters: opts.distance } : {}),
  };
}

/** 可编程 LBS stub：记录 searchPOI / searchNearby 调用参数并返回预置结果 */
function stubLBS(options: {
  poiByQuery?: Record<string, POISearchOutcome>;
  nearby?: POISearchOutcome;
  nearbyKeyword?: string[];
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
    return options.poiByQuery?.[query] ?? { status: 'POI_NOT_FOUND', candidates: [] };
  };
  (service as unknown as { searchNearby: (k: string, lat: number, lng: number) => Promise<POISearchOutcome> }).searchNearby =
    async (keyword: string, latitude: number, longitude: number) => {
      service.nearbyQueries.push({ keyword, lat: latitude, lng: longitude });
      if (options.nearbyKeyword && !options.nearbyKeyword.includes(keyword)) {
        return { status: 'POI_NOT_FOUND', candidates: [] };
      }
      return options.nearby ?? { status: 'POI_NOT_FOUND', candidates: [] };
    };
  return service;
}

const DEFAULT_TIME_RANGE = { start: '2026-09-10T09:00:00+08:00', timezone: TZ };
const YUEXIU_PARK = tencentCandidate('越秀公园', { address: '广东省广州市越秀区解放北路988号' });

export async function runMealResolutionTests(): Promise<void> {
  // ---------- A. 「附近粤菜」→ 具体真实餐厅（无 sequenceConstraint，靠回看锚点） ----------
  await record('A. 「附近粤菜」+ 前置已解析活动 → 具体真实餐厅（不再是抽象文案）', async () => {
    const lbs = stubLBS({
      poiByQuery: { 越秀公园: { status: 'FOUND', candidates: [YUEXIU_PARK] } },
      nearby: {
        status: 'FOUND',
        candidates: [
          tencentCandidate('粤味轩粤菜馆', { distance: 350, address: '广东省广州市越秀区解放北路100号' }),
          tencentCandidate('老广粤菜坊', { distance: 900, address: '广东省广州市越秀区环市中路99号' }),
        ],
      },
      nearbyKeyword: ['粤菜'],
    });
    const result = await postProcessTripPlan(
      {
        plan: makePlan([
          makeEvent({ id: 'event_1', title: '越秀公园', time: { start: '2026-09-10T14:00:00+08:00', timezone: TZ } }),
          makeEvent({ id: 'event_2', type: 'DINING', title: '附近粤菜', time: { start: '2026-09-10T18:00:00+08:00', timezone: TZ } }),
        ]),
        timeRange: DEFAULT_TIME_RANGE,
        city: '广州市',
        commentText: '越秀公园逛完，晚上附近吃粤菜。',
      },
      lbs,
    );
    const meal = result.plan.events[1];
    // 不得只留下抽象「附近粤菜」：必须有具体真实餐厅
    assert.ok(meal.restaurant, '「附近粤菜」必须解析出具体真实餐厅');
    assert.strictEqual(meal.restaurant?.name, '粤味轩粤菜馆', '确定性 top（距离近优先）');
    assert.strictEqual(meal.restaurant?.providerRefs?.[0]?.provider, 'tencent');
    // 其余真实候选进入 restaurantCandidates（前端「查看 1 个备选」）
    assert.strictEqual(meal.restaurantCandidates?.length, 2, 'top + 其余真实候选都保留');
    assert.strictEqual(meal.restaurantCandidates?.[1]?.name, '老广粤菜坊');
    // anchor = 回看最近的已解析活动（越秀公园）真实坐标
    assert.strictEqual(lbs.nearbyQueries.length, 1);
    assert.strictEqual(lbs.nearbyQueries[0].keyword, '粤菜');
    assert.strictEqual(lbs.nearbyQueries[0].lat, 23.13, 'anchor 必须是越秀公园真实坐标');
  });

  // ---------- A. Tencent 返回 0 → 保留抽象意图，无 mock ----------
  await record('A. Tencent 粤菜返回 0 → restaurant undefined，不伪造店名', async () => {
    const lbs = stubLBS({
      poiByQuery: { 越秀公园: { status: 'FOUND', candidates: [YUEXIU_PARK] } },
      nearby: { status: 'POI_NOT_FOUND', candidates: [] },
    });
    const result = await postProcessTripPlan(
      {
        plan: makePlan([
          makeEvent({ id: 'event_1', title: '越秀公园', time: { start: '2026-09-10T14:00:00+08:00', timezone: TZ } }),
          makeEvent({ id: 'event_2', type: 'DINING', title: '附近粤菜', time: { start: '2026-09-10T18:00:00+08:00', timezone: TZ } }),
        ]),
        timeRange: DEFAULT_TIME_RANGE,
        city: '广州市',
        commentText: '越秀公园逛完，晚上附近吃粤菜。',
      },
      lbs,
    );
    const meal = result.plan.events[1];
    assert.strictEqual(meal.restaurant, undefined, '腾讯 0 结果时不得伪造店名');
    assert.strictEqual(meal.restaurantCandidates, undefined);
    assert.strictEqual(meal.title, '附近粤菜', '保留抽象 unresolved intent');
  });

  // ---------- B. anchor 优先级 1：明确地点 > 前置活动坐标 ----------
  await record('B. 非餐饮活动带先后关系时仍解析自身明确地点（博物馆不得用图书馆坐标）', async () => {
    const lbs = stubLBS({
      poiByQuery: {
        广州图书馆: { status: 'FOUND', candidates: [tencentCandidate('广州图书馆', { address: '广东省广州市天河区珠江东路4号' })] },
        省博物馆: { status: 'FOUND', candidates: [tencentCandidate('广东省博物馆', { address: '广东省广州市天河区珠江东路2号', lat: 23.1141, lng: 113.3215 })] },
      },
    });
    const result = await postProcessTripPlan(
      {
        plan: makePlan([
          makeEvent({ id: 'event_1', title: '广州图书馆看书', time: { start: '2026-09-10T10:00:00+08:00', timezone: TZ } }),
          makeEvent({ id: 'event_2', type: 'OTHER', title: '参观省博物馆', time: { start: '2026-09-10T13:00:00+08:00', timezone: TZ } }),
        ]),
        timeRange: DEFAULT_TIME_RANGE,
        city: '广州市',
        commentText: '10点到广州图书馆看书，然后去省博参观。',
      },
      lbs,
    );
    const museum = result.plan.events[1];
    assert.ok(museum.sequenceConstraint, '博物馆应在图书馆之后');
    assert.strictEqual(museum.location?.name, '广东省博物馆', '明确地点必须优先于前置坐标');
    assert.strictEqual(museum.location?.latitude, 23.1141, '必须是博物馆自身真实坐标，不是图书馆坐标');
  });

  // ---------- B. anchor 优先级 3：回看最近已解析活动（不是最前活动） ----------
  await record('B. 省略地点餐饮：anchor 为最近已解析活动而非第一个活动', async () => {
    const lbs = stubLBS({
      poiByQuery: {
        越秀公园: { status: 'FOUND', candidates: [tencentCandidate('越秀公园', { lat: 23.138, lng: 113.265 })] },
        广州塔: { status: 'FOUND', candidates: [tencentCandidate('广州塔', { lat: 23.1066, lng: 113.3244 })] },
      },
      nearby: {
        status: 'FOUND',
        candidates: [tencentCandidate('珠江粤菜馆', { distance: 200, address: '广东省广州市海珠区阅江西路222号' })],
      },
      nearbyKeyword: ['粤菜'],
    });
    const result = await postProcessTripPlan(
      {
        plan: makePlan([
          makeEvent({ id: 'event_1', title: '越秀公园', time: { start: '2026-09-10T09:00:00+08:00', timezone: TZ } }),
          makeEvent({ id: 'event_2', title: '广州塔', time: { start: '2026-09-10T12:00:00+08:00', timezone: TZ } }),
          makeEvent({ id: 'event_3', type: 'DINING', title: '吃粤菜', time: { start: '2026-09-10T18:00:00+08:00', timezone: TZ } }),
        ]),
        timeRange: DEFAULT_TIME_RANGE,
        city: '广州市',
        commentText: '上午去越秀公园，中午去广州塔，晚上附近吃粤菜。',
      },
      lbs,
    );
    assert.strictEqual(lbs.nearbyQueries.length, 1);
    assert.strictEqual(lbs.nearbyQueries[0].lat, 23.1066, 'anchor 必须是最近的已解析活动（广州塔），不是越秀公园');
  });

  // ---------- P. 确定性 top + 其余真实候选 ----------
  await record('P. Tencent 返回 A/B → restaurant = 确定性 top（A），alternatives = 其余真实候选', async () => {
    const lbs = stubLBS({
      poiByQuery: { 越秀公园: { status: 'FOUND', candidates: [YUEXIU_PARK] } },
      nearby: {
        status: 'FOUND',
        candidates: [
          tencentCandidate('Restaurant A', { distance: 500 }),
          tencentCandidate('Restaurant B', { distance: 800 }),
        ],
      },
      nearbyKeyword: ['粤菜'],
    });
    const result = await postProcessTripPlan(
      {
        plan: makePlan([
          makeEvent({ id: 'event_1', title: '越秀公园', time: { start: '2026-09-10T14:00:00+08:00', timezone: TZ } }),
          makeEvent({ id: 'event_2', type: 'DINING', title: '吃粤菜', time: { start: '2026-09-10T18:00:00+08:00', timezone: TZ } }),
        ]),
        timeRange: DEFAULT_TIME_RANGE,
        city: '广州市',
        commentText: '越秀公园逛完，附近吃粤菜。',
      },
      lbs,
    );
    const meal = result.plan.events[1];
    assert.strictEqual(meal.restaurant?.name, 'Restaurant A', '确定性 top 结果');
    assert.strictEqual(meal.restaurantCandidates?.length, 2, 'top + 备选都保留');
    assert.strictEqual(meal.restaurantCandidates?.[1]?.name, 'Restaurant B');
    assert.strictEqual(meal.restaurantCandidates?.[1]?.providerRefs?.[0]?.provider, 'tencent');
  });

  // ---------- P. 中文菜系：支持 火锅/咖啡/吃饭/找餐厅 等通用路径 ----------
  await record('P. 通用餐饮：火锅/咖啡/吃饭/找餐厅 全部走 Tencent nearby + 真实餐厅', async () => {
    const lbs = stubLBS({
      poiByQuery: { 越秀公园: { status: 'FOUND', candidates: [YUEXIU_PARK] } },
      nearby: {
        status: 'FOUND',
        candidates: [tencentCandidate('海底捞火锅店', { distance: 300, address: '广东省广州市越秀区北京路88号' })],
      },
    });
    const result = await postProcessTripPlan(
      {
        plan: makePlan([
          makeEvent({ id: 'event_1', title: '越秀公园', time: { start: '2026-09-10T14:00:00+08:00', timezone: TZ } }),
          makeEvent({ id: 'event_2', type: 'DINING', title: '晚上附近吃火锅', time: { start: '2026-09-10T18:00:00+08:00', timezone: TZ } }),
        ]),
        timeRange: DEFAULT_TIME_RANGE,
        city: '广州市',
        commentText: '越秀公园逛完，晚上附近吃火锅。',
      },
      lbs,
    );
    const meal = result.plan.events[1];
    assert.strictEqual(lbs.nearbyQueries[0].keyword, '火锅', '火锅走同一 nearby 路径');
    assert.strictEqual(meal.restaurant?.name, '海底捞火锅店');
  });
}
