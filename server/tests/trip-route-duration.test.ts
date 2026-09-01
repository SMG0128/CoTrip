// trip-route-duration.test.ts
// 真实 Tencent route duration 参与排程测试（G/H/I/J/K/L/M/Q/R 节）。
//
// 覆盖：
//   Q. 真实 route duration → earliest start = A.end + REAL_API_VALUE（不是 11:00，也不是 11:30）
//   R. route provider 失败 → 无 fake duration、route undefined、sequence 保留
//   L. 固定硬约束时间晚于 earliest → 尊重用户时间（max 规则）
//   L. 固定硬约束时间早于 earliest → 不重叠，顺延到 earliest（真实 travel 优先）
//   M. 餐厅活动参与路线：route 终点是真实餐厅坐标（餐厅不是排程例外）
//   I. 用户明确指定交通偏好（步行）→ 尊重
//   J. 无方向服务 → route 不写入、不声称存在具体 travel time
//
// 全部使用可编程 direction stub，不依赖真实网络。

import assert from 'assert';
import { record } from './run-tests';
import { postProcessTripPlan } from '../src/services/trip-plan-post-processor';
import {
  DirectionOutcome,
  TencentDirectionMode,
  TencentDirectionService,
} from '../src/services/tencent-direction-service';
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

function tencentCandidate(name: string, opts: { lat?: number; lng?: number; address?: string } = {}): PlaceCandidate {
  return {
    provider: 'tencent',
    providerPoiId: `poi_${name}`,
    name,
    latitude: opts.lat ?? 23.13,
    longitude: opts.lng ?? 113.32,
    ...(opts.address ? { address: opts.address } : {}),
  };
}

/** 可编程 LBS stub（同 trip-generic-poi-food.test.ts 模式） */
function stubLBS(options: {
  poiByQuery?: Record<string, POISearchOutcome>;
  nearby?: POISearchOutcome;
}): TencentLBSService & { nearbyQueries: { keyword: string; lat: number; lng: number }[] } {
  const service = new TencentLBSService({ key: 'test-key' }) as TencentLBSService & {
    nearbyQueries: { keyword: string; lat: number; lng: number }[];
  };
  service.nearbyQueries = [];
  (service as unknown as { searchPOI: (q: string, city: string) => Promise<POISearchOutcome> }).searchPOI = async (
    query: string,
  ) => options.poiByQuery?.[query] ?? { status: 'POI_NOT_FOUND', candidates: [] };
  (service as unknown as { searchNearby: (k: string, lat: number, lng: number) => Promise<POISearchOutcome> }).searchNearby =
    async (keyword: string, latitude: number, longitude: number) => {
      service.nearbyQueries.push({ keyword, lat: latitude, lng: longitude });
      return options.nearby ?? { status: 'POI_NOT_FOUND', candidates: [] };
    };
  return service;
}

/** 可编程 direction stub：记录 from/to/mode，返回预置结果 */
function stubDirections(options: {
  outcome?: DirectionOutcome;
  throwOn?: boolean;
}): TencentDirectionService & { calls: { from: { latitude: number; longitude: number }; to: { latitude: number; longitude: number }; mode: TencentDirectionMode }[] } {
  const service = new TencentDirectionService({ key: 'test-key' }) as TencentDirectionService & {
    calls: { from: { latitude: number; longitude: number }; to: { latitude: number; longitude: number }; mode: TencentDirectionMode }[];
  };
  service.calls = [];
  (service as unknown as { getDirection: (from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }, mode: TencentDirectionMode) => Promise<DirectionOutcome> }).getDirection = async (
    from,
    to,
    mode,
  ) => {
    service.calls.push({ from, to, mode });
    if (options.throwOn) throw new Error('direction provider down');
    return options.outcome ?? { status: 'DIRECTION_UNAVAILABLE' };
  };
  return service;
}

const DEFAULT_TIME_RANGE = { start: '2026-09-10T09:00:00+08:00', timezone: TZ };
const GUANGZHOU_LIBRARY = tencentCandidate('广州图书馆', { address: '广东省广州市天河区珠江东路4号' });
const GUANGDONG_MUSEUM = tencentCandidate('广东省博物馆', { lat: 23.1141, lng: 113.3215, address: '广东省广州市天河区珠江东路2号' });
const YUEXIU_PARK = tencentCandidate('越秀公园', { address: '广东省广州市越秀区解放北路988号' });

const LIBRARY_POIS: {
  poiByQuery: Record<string, POISearchOutcome>;
} = {
  poiByQuery: {
    广州图书馆: { status: 'FOUND', candidates: [GUANGZHOU_LIBRARY] },
    省博物馆: { status: 'FOUND', candidates: [GUANGDONG_MUSEUM] },
    越秀公园: { status: 'FOUND', candidates: [YUEXIU_PARK] },
  },
};

export async function runRouteDurationTests(): Promise<void> {
  // ---------- Q. 真实 route duration 参与排程 ----------
  await record('Q. route=12min → museum earliest start = 11:12（不是 11:00，不是 11:30）', async () => {
    const lbs = stubLBS(LIBRARY_POIS);
    const directions = stubDirections({
      outcome: { status: 'FOUND', route: { durationMinutes: 12, distanceMeters: 1000, mode: 'transit', provider: 'tencent' } },
    });
    const result = await postProcessTripPlan(
      {
        plan: makePlan([
          makeEvent({ id: 'event_1', title: '广州图书馆看书', time: { start: '2026-09-10T10:00:00+08:00', timezone: TZ } }),
          makeEvent({ id: 'event_2', type: 'OTHER', title: '参观省博物馆', time: { start: '2026-09-10T11:00:00+08:00', timezone: TZ } }),
        ]),
        timeRange: DEFAULT_TIME_RANGE,
        city: '广州市',
        commentText: '10点到广州图书馆看书1小时，然后去省博物馆参观。',
      },
      lbs,
      directions,
    );
    const museum = result.plan.events[1];
    assert.strictEqual(
      museum.time?.start,
      '2026-09-10T11:12:00+08:00',
      'earliest start 必须是 11:12（A.end 11:00 + 真实 12min）',
    );
    assert.ok(museum.route, 'final plan 必须保存真实 route segment');
    assert.strictEqual(museum.route?.durationMinutes, 12);
    assert.strictEqual(museum.route?.fromEventId, 'event_1');
    assert.strictEqual(museum.route?.provider, 'tencent');
    assert.strictEqual(directions.calls.length, 1);
  });

  // ---------- L. 用户硬约束晚于 earliest → 尊重用户时间 ----------
  await record('L. B 硬约束 14:00 晚于 earliest 11:12 → start 保持 14:00（max 规则）', async () => {
    const lbs = stubLBS(LIBRARY_POIS);
    const directions = stubDirections({
      outcome: { status: 'FOUND', route: { durationMinutes: 12, mode: 'transit', provider: 'tencent' } },
    });
    const result = await postProcessTripPlan(
      {
        plan: makePlan([
          makeEvent({ id: 'event_1', title: '广州图书馆看书', time: { start: '2026-09-10T10:00:00+08:00', timezone: TZ } }),
          makeEvent({ id: 'event_2', type: 'OTHER', title: '参观省博物馆', time: { start: '2026-09-10T14:00:00+08:00', timezone: TZ } }),
        ]),
        timeRange: DEFAULT_TIME_RANGE,
        city: '广州市',
        commentText: '10点到广州图书馆看书1小时，然后去省博物馆参观。',
      },
      lbs,
      directions,
    );
    assert.strictEqual(result.plan.events[1].time?.start, '2026-09-10T14:00:00+08:00');
  });

  // ---------- L. 硬约束早于 earliest → 不重叠，顺延 ----------
  await record('L. A end=13:00 + 真实 25min，B 硬约束 13:10 → B 顺延到 13:25（不重叠、不忽略路线）', async () => {
    const lbs = stubLBS(LIBRARY_POIS);
    const directions = stubDirections({
      outcome: { status: 'FOUND', route: { durationMinutes: 25, mode: 'transit', provider: 'tencent' } },
    });
    const result = await postProcessTripPlan(
      {
        plan: makePlan([
          makeEvent({ id: 'event_1', title: '广州图书馆看书', time: { start: '2026-09-10T10:00:00+08:00', timezone: TZ } }),
          makeEvent({ id: 'event_2', type: 'OTHER', title: '参观省博物馆', time: { start: '2026-09-10T13:10:00+08:00', timezone: TZ } }),
        ]),
        timeRange: DEFAULT_TIME_RANGE,
        city: '广州市',
        commentText: '10点到广州图书馆看书3小时，然后去省博物馆参观。',
      },
      lbs,
      directions,
    );
    assert.strictEqual(
      result.plan.events[1].time?.start,
      '2026-09-10T13:25:00+08:00',
      '不得重叠或忽略真实路线',
    );
  });

  // ---------- R. route 失败 → 无 fake duration ----------
  await record('R. direction throws → 无 fake duration、route undefined、sequence 保留', async () => {
    const lbs = stubLBS(LIBRARY_POIS);
    const directions = stubDirections({ throwOn: true });
    const result = await postProcessTripPlan(
      {
        plan: makePlan([
          makeEvent({ id: 'event_1', title: '广州图书馆看书', time: { start: '2026-09-10T10:00:00+08:00', timezone: TZ } }),
          makeEvent({ id: 'event_2', type: 'OTHER', title: '参观省博物馆', time: { start: '2026-09-10T11:00:00+08:00', timezone: TZ } }),
        ]),
        timeRange: DEFAULT_TIME_RANGE,
        city: '广州市',
        commentText: '10点到广州图书馆看书1小时，然后去省博物馆参观。',
      },
      lbs,
      directions,
    );
    const museum = result.plan.events[1];
    assert.ok(museum.sequenceConstraint, 'sequence 必须保留');
    assert.strictEqual(museum.route, undefined, '失败时不得写入 route');
    assert.strictEqual(museum.time?.start, '2026-09-10T11:00:00+08:00', '无 fake travel，start = previous.end');
  });

  // ---------- J. 无 direction 服务 → 不声称存在具体 travel time ----------
  await record('J. 未注入方向服务 → route 不写入、start = previous.end', async () => {
    const lbs = stubLBS(LIBRARY_POIS);
    const result = await postProcessTripPlan(
      {
        plan: makePlan([
          makeEvent({ id: 'event_1', title: '广州图书馆看书', time: { start: '2026-09-10T10:00:00+08:00', timezone: TZ } }),
          makeEvent({ id: 'event_2', type: 'OTHER', title: '参观省博物馆', time: { start: '2026-09-10T11:00:00+08:00', timezone: TZ } }),
        ]),
        timeRange: DEFAULT_TIME_RANGE,
        city: '广州市',
        commentText: '10点到广州图书馆看书1小时，然后去省博物馆参观。',
      },
      lbs,
      null,
    );
    assert.strictEqual(result.plan.events[1].route, undefined);
    assert.strictEqual(result.plan.events[1].time?.start, '2026-09-10T11:00:00+08:00');
  });

  // ---------- M. 餐厅参与路线：route 终点 = 真实餐厅坐标 ----------
  await record('M. 越秀公园 → 真实粤菜餐厅：route 终点是餐厅坐标，不是公园坐标', async () => {
    const lbs = stubLBS({
      poiByQuery: { 越秀公园: { status: 'FOUND', candidates: [YUEXIU_PARK] } },
      nearby: {
        status: 'FOUND',
        candidates: [tencentCandidate('粤味轩粤菜馆', { lat: 23.1105, lng: 113.301, address: '广东省广州市越秀区解放北路100号' })],
      },
    });
    const directions = stubDirections({
      outcome: { status: 'FOUND', route: { durationMinutes: 8, distanceMeters: 650, mode: 'walking', provider: 'tencent' } },
    });
    const result = await postProcessTripPlan(
      {
        plan: makePlan([
          makeEvent({ id: 'event_1', title: '越秀公园', time: { start: '2026-09-10T14:00:00+08:00', timezone: TZ } }),
          makeEvent({ id: 'event_2', type: 'DINING', title: '吃粤菜', time: { start: '2026-09-10T18:00:00+08:00', timezone: TZ } }),
        ]),
        timeRange: DEFAULT_TIME_RANGE,
        city: '广州市',
        commentText: '逛完越秀公园，晚上附近吃粤菜。',
      },
      lbs,
      directions,
    );
    const meal = result.plan.events[1];
    assert.ok(meal.restaurant, '餐厅必须解析成功');
    assert.ok(meal.route, '餐厅活动必须参与路线');
    assert.strictEqual(meal.route?.fromEventId, 'event_1');
    assert.strictEqual(directions.calls.length, 1);
    // route 终点是餐厅真实坐标（23.1105/113.301），不是公园坐标（23.13/113.32）
    assert.strictEqual(directions.calls[0].to.latitude, 23.1105, '路线终点必须是餐厅坐标');
    assert.strictEqual(directions.calls[0].to.longitude, 113.301);
    assert.strictEqual(directions.calls[0].from.latitude, 23.13, '路线起点是公园坐标');
    // 18:00 远晚于 park.end + 8min → 保持 18:00
    assert.strictEqual(meal.time?.start, '2026-09-10T18:00:00+08:00');
  });

  // ---------- I. 用户明确指定交通偏好 ----------
  await record('I. routeMode=步行 → 使用 walking，不用默认 transit', async () => {
    const lbs = stubLBS(LIBRARY_POIS);
    const directions = stubDirections({
      outcome: { status: 'FOUND', route: { durationMinutes: 12, mode: 'walking', provider: 'tencent' } },
    });
    const result = await postProcessTripPlan(
      {
        plan: makePlan([
          makeEvent({ id: 'event_1', title: '广州图书馆看书', time: { start: '2026-09-10T10:00:00+08:00', timezone: TZ } }),
          makeEvent({ id: 'event_2', type: 'OTHER', title: '参观省博物馆', time: { start: '2026-09-10T11:00:00+08:00', timezone: TZ } }),
        ]),
        timeRange: DEFAULT_TIME_RANGE,
        city: '广州市',
        commentText: '10点到广州图书馆看书1小时，然后走路去省博物馆参观。',
        routeMode: '步行',
      },
      lbs,
      directions,
    );
    assert.strictEqual(directions.calls[0].mode, 'walking', '必须尊重用户指定「步行」');
    assert.strictEqual(result.plan.events[1].route?.mode, 'walking');
  });

  // ---------- G. 默认 mode：transit 优先，失败后 walking 兜底 ----------
  await record('G. 未指定 mode → transit 优先，transit 不可用时 walking 兜底', async () => {
    const lbs = stubLBS(LIBRARY_POIS);
    const directions = stubDirections({
      outcome: { status: 'FOUND', route: { durationMinutes: 20, mode: 'walking', provider: 'tencent' } },
    });
    // 第一次（transit）返回不可用，第二次（walking）返回 FOUND
    let call = 0;
    (directions as unknown as { getDirection: (from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }, mode: TencentDirectionMode) => Promise<DirectionOutcome> }).getDirection = async (from, to, mode) => {
      directions.calls.push({ from, to, mode });
      call += 1;
      if (call === 1) return { status: 'DIRECTION_UNAVAILABLE' };
      return { status: 'FOUND', route: { durationMinutes: 20, mode: 'walking', provider: 'tencent' } };
    };
    const result = await postProcessTripPlan(
      {
        plan: makePlan([
          makeEvent({ id: 'event_1', title: '广州图书馆看书', time: { start: '2026-09-10T10:00:00+08:00', timezone: TZ } }),
          makeEvent({ id: 'event_2', type: 'OTHER', title: '参观省博物馆', time: { start: '2026-09-10T11:00:00+08:00', timezone: TZ } }),
        ]),
        timeRange: DEFAULT_TIME_RANGE,
        city: '广州市',
        commentText: '10点到广州图书馆看书1小时，然后去省博物馆参观。',
      },
      lbs,
      directions,
    );
    assert.deepStrictEqual(directions.calls.map((c) => c.mode), ['transit', 'walking']);
    assert.strictEqual(result.plan.events[1].route?.mode, 'walking');
    assert.strictEqual(result.plan.events[1].time?.start, '2026-09-10T11:20:00+08:00', '用真实 walking 20min 排程');
  });
}
