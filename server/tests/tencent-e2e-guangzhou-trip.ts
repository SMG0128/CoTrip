// tencent-e2e-guangzhou-trip.ts
// 真实腾讯 LBS + direction E2E：广州 2026-09-10 行程
//   10:00 广州图书馆看书 3 小时
//   13:00 参观省博物馆（粤博）
//   15:00 越秀公园
//   18:00 晚上附近吃粤菜
//
// 验证（I/S 节）：
//   - 日期为 9月10日（事件 local date = 2026-09-10）
//   - 广图 / 粤博 / 越秀公园 真实腾讯 POI
//   - 顺序链接：粤博 after 广图、越秀 after 粤博、餐厅 after 越秀
//   - 每个实体如实报告 address PRESENT / MISSING（缺失时绝不伪造）
//   - 粤菜 nearby anchor = 越秀公园（sequenceConstraint.afterActivityId = 越秀事件）
//   - 至少返回一条真实 Tencent restaurant candidate
//   - candidate 名称不得命中本地 mock 名单（蔡澜Pho/越芽/大头虾 等 fixture）
//   - Tencent 未返回 rating → restaurant.rating undefined
//   - 三段真实 route（direction v1）：广图→粤博、粤博→越秀、越秀→餐厅
//     provider=tencent、durationMinutes>0、fromEventId 正确
//   - 时间轴不重叠：event[i+1].start >= event[i].end + route[i+1].durationMinutes
//
// 安全：Key 只从环境变量 TENCENT_MAP_KEY 显式注入；绝不打印 Key / 请求 URL。
// 真实网络不可用时输出 BLOCKED 并以退出码 2 结束（不伪造 PASS）。

import { TencentLBSService } from '../src/services/tencent-lbs-service';
import {
  DirectionOutcome,
  TencentDirectionMode,
  TencentDirectionService,
  TencentRouteResult,
} from '../src/services/tencent-direction-service';
import { postProcessTripPlan } from '../src/services/trip-plan-post-processor';
import { TripPlan, TripPlanEvent } from '../src/types/trip-plan';

/** 本地 mock / fixture 餐厅名单：真实 E2E 候选不得命中（命中即 FAIL） */
const MOCK_RESTAURANT_MARKERS = ['蔡澜Pho', '越芽', '大头虾', '泰香米', '一记面馆', '大家乐'];

interface RecordedDirectionCall {
  from: { latitude: number; longitude: number };
  to: { latitude: number; longitude: number };
  mode: TencentDirectionMode;
  outcome: DirectionOutcome;
}

class RecordingTencentDirectionService extends TencentDirectionService {
  readonly calls: RecordedDirectionCall[] = [];

  async getDirection(
    from: { latitude: number; longitude: number },
    to: { latitude: number; longitude: number },
    mode: TencentDirectionMode = 'transit',
  ): Promise<DirectionOutcome> {
    const outcome = await super.getDirection(from, to, mode);
    this.calls.push({ from, to, mode, outcome });
    return outcome;
  }
}

function getKey(): string {
  const fromEnv = process.env.TENCENT_MAP_KEY?.trim();
  if (fromEnv) return fromEnv;
  throw new Error(
    'TENCENT_MAP_KEY 未设置：真实 E2E 需要显式注入 env（export TENCENT_MAP_KEY=...）。' +
      'server runtime 只读取 process.env.TENCENT_MAP_KEY，不从 frontend config 读取。',
  );
}

function fail(message: string): never {
  console.error(`✗ FAIL: ${message}`);
  process.exit(1);
}

function assert(cond: boolean, message: string): void {
  if (!cond) fail(message);
}

/** 事件的“生效结束时间”：有 end 用 end，无 end 视为 start（活动不重叠判断用） */
function effectiveEnd(event: TripPlanEvent): string {
  return event.time?.end ?? event.time?.start ?? '';
}

function minutesBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60_000);
}

function eventPoint(event: TripPlanEvent): { latitude: number; longitude: number } {
  const location = event.restaurant?.location ?? event.location;
  assert(!!location, `${event.id} 必须存在真实物理坐标`);
  return { latitude: location!.latitude, longitude: location!.longitude };
}

function isSamePoint(
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number },
): boolean {
  return left.latitude === right.latitude && left.longitude === right.longitude;
}

function formatRecordedOutcome(call: RecordedDirectionCall): string {
  if (call.outcome.status !== 'FOUND') return 'status=UNAVAILABLE';
  return `status=FOUND durationMinutes=${call.outcome.route.durationMinutes} distanceMeters=${call.outcome.route.distanceMeters ?? 'undefined'}`;
}

async function main(): Promise<void> {
  const key = getKey();
  const lbs = new TencentLBSService({ key });
  const directions = new RecordingTencentDirectionService({ key });

  console.log('=== REAL TENCENT E2E: 广州 2026-09-10（POI + 三段真实 route）===');

  const plan: TripPlan = {
    id: 'plan_e2e_guangzhou',
    tripId: 'trip_e2e_guangzhou',
    version: 1,
    events: [
      {
        id: 'event_1',
        type: 'OTHER',
        title: '广州图书馆看书',
        time: { start: '2026-09-10T10:00:00+08:00', timezone: 'Asia/Shanghai' },
      },
      {
        id: 'event_2',
        type: 'OTHER',
        title: '参观省博物馆',
        time: { start: '2026-09-10T13:00:00+08:00', timezone: 'Asia/Shanghai' },
      },
      {
        id: 'event_3',
        type: 'OTHER',
        title: '越秀公园',
        time: { start: '2026-09-10T15:00:00+08:00', timezone: 'Asia/Shanghai' },
      },
      {
        id: 'event_4',
        type: 'DINING',
        title: '吃粤菜',
        time: { start: '2026-09-10T18:00:00+08:00', timezone: 'Asia/Shanghai' },
      },
    ],
    satisfiedConstraintCount: 0,
    totalConstraintCount: 0,
    conflicts: [],
    updatedAt: '2026-09-01T00:00:00.000Z',
  };

  const result = await postProcessTripPlan(
    {
      plan,
      timeRange: { start: '2026-09-10T09:00:00+08:00', timezone: 'Asia/Shanghai' },
      commentText: '10点去广州图书馆看书3个小时，然后去粤博参观，再去越秀公园，晚上附近吃粤菜。',
      city: '广州市',
    },
    lbs,
    directions,
  );

  const events = result.plan.events;
  const byId = new Map(events.map((e) => [e.id, e]));
  const e1 = byId.get('event_1');
  const e2 = byId.get('event_2');
  const e3 = byId.get('event_3');
  const e4 = byId.get('event_4');

  console.log('\n--- POST-PROCESSOR RESULT ---');
  for (const ev of events) {
    console.log(`[${ev.id}] ${ev.title}`);
    console.log(
      `  time=${ev.time?.start ?? '(none)'} → ${ev.time?.end ?? '(none)'}  (${ev.time?.start ? minutesBetween('2026-09-10T00:00:00+08:00', ev.time.start) : '-'} 分钟)` +
        (ev.time?.end ? `，时长 ${minutesBetween(ev.time.start!, ev.time.end)} 分钟` : ''),
    );
    console.log(`  location=${ev.location?.name ?? '(none)'} | address=${ev.location?.address ? 'PRESENT' : 'MISSING'}`);
    if (ev.restaurant) {
      console.log(`  restaurant=${ev.restaurant.name} (rating=${ev.restaurant.rating?.score ?? '(none)'})`);
      console.log(`  restaurant address=${ev.restaurant.location?.address ? 'PRESENT' : 'MISSING'}`);
    }
    if (ev.sequenceConstraint) {
      console.log(`  sequence=after ${ev.sequenceConstraint.afterActivityId} (${ev.sequenceConstraint.locationConstraint})`);
    }
    if (ev.route) {
      console.log(
        `  route: ${ev.route.fromEventId} → ${ev.id} | ${ev.route.mode} ${ev.route.durationMinutes}min` +
          `${ev.route.distanceMeters !== undefined ? ` / ${ev.route.distanceMeters}m` : ''} | provider=${ev.route.provider}`,
      );
    }
  }

  // ---- 验证 ----
  // 1. 日期为 9月10日
  assert(!!e1, 'event_1 必须存在');
  const date = (e1!.time?.start ?? '').slice(0, 10);
  assert(date === '2026-09-10', `日期必须是 2026-09-10，实际 ${date}`);

  // 2. 三个真实 POI + tencent providerRefs
  for (const [id, expectName] of [
    ['event_1', '广州图书馆'],
    ['event_2', '省'],
    ['event_3', '越秀'],
  ] as const) {
    const ev = byId.get(id);
    assert(!!ev, `${id} 必须存在`);
    assert(!!ev!.location, `${id} 必须解析出真实 location`);
    assert(ev!.location!.name.includes(expectName), `${id} 名称应含「${expectName}」，实际 ${ev!.location!.name}`);
    assert(!!ev!.location!.providerRefs?.some((p) => p.provider === 'tencent'), `${id} 必须带 tencent providerRefs`);
  }

  // 3. 顺序链接：粤博 after 广图、越秀 after 粤博、餐厅 after 越秀
  assert(e2!.sequenceConstraint?.afterActivityId === 'event_1', `粤博必须 after event_1，实际 ${e2!.sequenceConstraint?.afterActivityId ?? '(none)'}`);
  assert(e3!.sequenceConstraint?.afterActivityId === 'event_2', `越秀必须 after event_2，实际 ${e3!.sequenceConstraint?.afterActivityId ?? '(none)'}`);
  assert(e4!.sequenceConstraint?.afterActivityId === 'event_3', `餐厅必须 after event_3（越秀），实际 ${e4!.sequenceConstraint?.afterActivityId ?? '(none)'}`);
  assert(
    e4!.sequenceConstraint?.locationConstraint === 'near_previous_activity',
    '餐厅位置约束必须 near_previous_activity',
  );

  // 4. 真实餐厅 + 非 mock + 不伪造 rating/avgPrice
  assert(!!e4!.restaurant, '吃粤菜必须解析出真实腾讯餐厅');
  assert(
    !!e4!.restaurant!.providerRefs?.some((p) => p.provider === 'tencent'),
    '餐厅必须带 tencent providerRefs',
  );
  const restaurantName = e4!.restaurant!.name;
  const hitMock = MOCK_RESTAURANT_MARKERS.some((m) => restaurantName.includes(m));
  assert(!hitMock, `候选不得为本地 mock（命中 ${restaurantName}）`);
  assert(e4!.restaurant!.rating === undefined, 'rating 必须为 undefined（不得伪造）');
  assert(e4!.restaurant!.averagePrice === undefined, 'avgPrice 必须为 undefined（不得伪造）');
  // 餐厅 anchor = 越秀公园真实坐标（nearby 至少命中一次）
  assert(
    (e4!.restaurant!.location?.latitude ?? 0) !== (e3!.location!.latitude ?? 0) ||
      (e4!.restaurant!.location?.longitude ?? 0) !== (e3!.location!.longitude ?? 0),
    '餐厅坐标应是越秀公园附近的新 POI，而不是越秀公园本身',
  );

  // 5. 三段真实 route：provider=tencent、duration>0、fromEventId 正确
  const routeExpectations: [TripPlanEvent | undefined, string][] = [
    [e2, 'event_1'],
    [e3, 'event_2'],
    [e4, 'event_3'],
  ];
  const realDurations: number[] = [];
  for (const [ev, expectedFrom] of routeExpectations) {
    assert(!!ev, '路线终点事件必须存在');
    assert(!!ev!.route, `${ev!.id} 必须携带真实 route 段`);
    assert(ev!.route!.provider === 'tencent', `${ev!.id} route provider 必须为 tencent`);
    assert(ev!.route!.durationMinutes > 0, `${ev!.id} route duration 必须为正数`);
    assert(ev!.route!.fromEventId === expectedFrom, `${ev!.id} route fromEventId 必须为 ${expectedFrom}`);
    assert(typeof ev!.route!.mode === 'string' && ['transit', 'walking', 'driving'].includes(ev!.route!.mode), `${ev!.id} route mode 非法`);
    realDurations.push(ev!.route!.durationMinutes);
  }
  console.log(`\n三段真实 route duration（分钟）: ${realDurations.join(' / ')}`);

  // 每段必须实际请求 walking + transit，并由两个真实候选中的最短 duration 决定 selected。
  const comparisonSegments = [
    { label: 'LIBRARY_TO_MUSEUM', from: e1!, to: e2! },
    { label: 'MUSEUM_TO_YUEXIU', from: e2!, to: e3! },
    { label: 'YUEXIU_TO_RESTAURANT', from: e3!, to: e4! },
  ];
  console.log('\n--- REAL ROUTE CANDIDATE COMPARISON ---');
  for (const segment of comparisonSegments) {
    const from = eventPoint(segment.from);
    const to = eventPoint(segment.to);
    const calls = directions.calls.filter(
      (call) => isSamePoint(call.from, from) && isSamePoint(call.to, to),
    );
    const walking = calls.find((call) => call.mode === 'walking');
    const transit = calls.find((call) => call.mode === 'transit');
    assert(!!walking, `${segment.label} 必须实际请求 walking`);
    assert(!!transit, `${segment.label} 必须实际请求 transit`);

    const found: { mode: TencentDirectionMode; route: TencentRouteResult }[] = [];
    for (const call of [walking!, transit!]) {
      if (call.outcome.status === 'FOUND') {
        found.push({ mode: call.mode, route: call.outcome.route });
      }
    }
    found.sort((left, right) =>
      left.route.durationMinutes - right.route.durationMinutes ||
      (left.mode === 'walking' ? -1 : right.mode === 'walking' ? 1 : 0),
    );
    assert(found.length > 0, `${segment.label} walking / transit 不得同时 unavailable`);
    const selected = segment.to.route!;
    assert(selected.mode === found[0].mode, `${segment.label} selected mode 必须来自最短真实候选`);
    assert(
      selected.durationMinutes === found[0].route.durationMinutes,
      `${segment.label} selected duration 必须等于最短真实候选`,
    );

    console.log(segment.label);
    console.log(`  WALKING: ${formatRecordedOutcome(walking!)}`);
    console.log(`  TRANSIT: ${formatRecordedOutcome(transit!)}`);
    console.log(
      `  SELECTED: mode=${selected.mode} durationMinutes=${selected.durationMinutes} distanceMeters=${selected.distanceMeters ?? 'undefined'}`,
    );
  }

  // 6. 时间轴不重叠：event[i+1].start >= event[i].end + route[i+1].durationMinutes
  const timeline: [TripPlanEvent | undefined, TripPlanEvent | undefined][] = [
    [e1, e2],
    [e2, e3],
    [e3, e4],
  ];
  for (const [prior, next] of timeline) {
    const priorEndIso = effectiveEnd(prior!);
    const nextStartIso = next!.time?.start;
    const routeMinutes = next!.route?.durationMinutes ?? 0;
    assert(!!priorEndIso && !!nextStartIso, `时间轴 ${prior!.id} → ${next!.id} 必须存在 start/end`);
    const gap = minutesBetween(priorEndIso, nextStartIso);
    assert(
      gap >= routeMinutes,
      `时间轴重叠：${prior!.id} end=${priorEndIso} → ${next!.id} start=${nextStartIso}，间隔 ${gap}min < 真实 route ${routeMinutes}min`,
    );
    console.log(`  timeline OK: ${prior!.id} end ${priorEndIso} → ${next!.id} start ${nextStartIso}（间隔 ${gap}min ≥ route ${routeMinutes}min）`);
  }

  console.log('\n=== REAL TENCENT E2E PASS ===');
  console.log('DATE_UI_E2E=PASS');
  console.log('GUANGZHOU_LIBRARY_LOCATION=PASS');
  console.log('GUANGDONG_MUSEUM_LOCATION=PASS');
  console.log('YUEXIU_PARK_LOCATION=PASS');
  console.log('SEQUENCE_CHAIN=PASS');
  console.log('TENCENT_NEARBY_ANCHOR=PASS');
  console.log('MOCK_RESTAURANT_SOURCE=NOT_HIT');
  console.log(`REAL_POI=PASS | name=${e1!.location!.name} | ADDRESS=${e1!.location!.address ? 'PRESENT' : 'MISSING'}`);
  console.log(`REAL_POI=PASS | name=${e2!.location!.name} | ADDRESS=${e2!.location!.address ? 'PRESENT' : 'MISSING'}`);
  console.log(`REAL_POI=PASS | name=${e3!.location!.name} | ADDRESS=${e3!.location!.address ? 'PRESENT' : 'MISSING'}`);
  console.log(`REAL_POI=PASS | name=${restaurantName} | ADDRESS=${e4!.restaurant!.location?.address ? 'PRESENT' : 'MISSING'}`);
  console.log(`REAL_ROUTE_RESULTS=${realDurations.join('/')} | provider=tencent | PASS`);
  console.log('TIMELINE_NON_OVERLAPPING=PASS');
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  if (
    message.includes('TENCENT_LBS') ||
    message.includes('TENCENT_MAP_KEY') ||
    message.includes('fetch') ||
    message.includes('abort')
  ) {
    console.error('\nBLOCKED: 真实网络/Tencent API 不可用或未注入 Key，E2E 无法执行，不伪造 PASS。');
    console.error(`原因: ${message}`);
    process.exit(2);
  }
  console.error('E2E FAILED:', message);
  process.exit(1);
});
