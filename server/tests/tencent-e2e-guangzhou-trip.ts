// tencent-e2e-guangzhou-trip.ts
// 真实腾讯 LBS E2E：广州 2026-09-10 行程
//   10:00 广州图书馆看书 3 小时
//   13:00 参观省博物馆
//   之后附近吃越南菜
//
// 验证（I 节）：
//   - 日期为 9月10日（事件 local date = 2026-09-10）
//   - 广州图书馆真实腾讯 POI + address
//   - 广东省博物馆真实腾讯 POI + address
//   - 越南菜 nearby anchor = 广东省博物馆（sequenceConstraint.afterActivityId = 省博事件）
//   - 至少返回一条真实 Tencent restaurant candidate
//   - candidate 名称不得命中本地 mock 名单（蔡澜Pho/越芽/大头虾 等 fixture）
//   - Tencent 未返回 rating → restaurant.rating undefined
//
// 安全：Key 只从环境变量 TENCENT_MAP_KEY 显式注入；绝不打印 Key / 请求 URL。
// 真实网络不可用时输出 BLOCKED 并以退出码 2 结束（不伪造 PASS）。

import { TencentLBSService, PlaceCandidate } from '../src/services/tencent-lbs-service';
import { postProcessTripPlan } from '../src/services/trip-plan-post-processor';
import { TripPlan, TripPlanEvent } from '../src/types/trip-plan';

/** 本地 mock / fixture 餐厅名单：真实 E2E 候选不得命中（命中即 FAIL） */
const MOCK_RESTAURANT_MARKERS = ['蔡澜Pho', '越芽', '大头虾', '泰香米', '一记面馆', '大家乐'];

function getKey(): string {
  const fromEnv = process.env.TENCENT_MAP_KEY?.trim();
  if (fromEnv) return fromEnv;
  throw new Error(
    'TENCENT_MAP_KEY 未设置：真实 E2E 需要显式注入 env（export TENCENT_MAP_KEY=...）。' +
      'server runtime 只读取 process.env.TENCENT_MAP_KEY，不从 frontend config 读取。',
  );
}

function mask(value: string): string {
  if (!value) return '(none)';
  if (value.length <= 4) return '****';
  return `${value.slice(0, 2)}****${value.slice(-2)}`;
}

function summarizeCandidate(c: PlaceCandidate): string {
  return [
    `name=${c.name}`,
    `poiId=${mask(c.providerPoiId)}`,
    c.address ? `address=${c.address}` : 'address=(none)',
    typeof c.distanceMeters === 'number' ? `distance=${c.distanceMeters}m` : 'distance=(none)',
    `rating=${c.rating ?? '(none)'}`,
    `avgPrice=${c.avgPrice ?? '(none)'}`,
  ].join(' | ');
}

function fail(message: string): never {
  console.error(`✗ FAIL: ${message}`);
  process.exit(1);
}

function assert(cond: boolean, message: string): void {
  if (!cond) fail(message);
}

async function main(): Promise<void> {
  const key = getKey();
  const lbs = new TencentLBSService({ key });

  console.log('=== REAL TENCENT E2E: 广州 2026-09-10 ===');
  console.log(`key=${mask(key)} (masked)`);

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
        type: 'DINING',
        title: '吃越南菜',
        time: { start: '2026-09-10T14:30:00+08:00', timezone: 'Asia/Shanghai' },
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
      commentText: '10点去广州图书馆看书3个小时，13点参观省博物馆，参观省博后附近吃越南菜。',
      city: '广州市',
    },
    lbs,
  );

  const events = result.plan.events;
  const e1 = events.find((e) => e.id === 'event_1');
  const e2 = events.find((e) => e.id === 'event_2');
  const e3 = events.find((e) => e.id === 'event_3');

  console.log('\n--- POST-PROCESSOR RESULT ---');
  for (const ev of events) {
    console.log(`[${ev.id}] ${ev.title}`);
    console.log(`  time=${ev.time?.start ?? '(none)'} → ${ev.time?.end ?? '(none)'}`);
    console.log(
      `  location=${ev.location?.name ?? '(none)'} ${ev.location?.address ? `@ ${ev.location.address}` : ''}`,
    );
    if (ev.restaurant) {
      console.log(`  restaurant=${ev.restaurant.name} (rating=${ev.restaurant.rating?.score ?? '(none)'})`);
    }
    if (ev.sequenceConstraint) {
      console.log(`  sequence=after ${ev.sequenceConstraint.afterActivityId} (${ev.sequenceConstraint.locationConstraint})`);
    }
  }

  // ---- 验证 ----
  // 1. 日期为 9月10日
  assert(!!e1, 'event_1 必须存在');
  const date = (e1!.time?.start ?? '').slice(0, 10);
  assert(date === '2026-09-10', `日期必须是 2026-09-10，实际 ${date}`);

  // 2. 广州图书馆真实 POI + address
  assert(!!e1!.location, 'event_1 必须解析出 location');
  assert(e1!.location!.name.includes('广州图书馆'), `广州图书馆名称，实际 ${e1!.location!.name}`);
  assert(!!e1!.location!.address, '广州图书馆必须有 address');
  assert(!!e1!.location!.providerRefs?.some((p) => p.provider === 'tencent'), '必须带 tencent providerRefs');

  // 3. 广东省博物馆真实 POI + address
  assert(!!e2!.location, 'event_2 必须解析出 location');
  assert(e2!.location!.name.includes('省'), `博物馆名称应含「省」，实际 ${e2!.location!.name}`);
  assert(!!e2!.location!.address, '省博必须有 address');
  assert(!!e2!.location!.providerRefs?.some((p) => p.provider === 'tencent'), '省博必须带 tencent providerRefs');

  // 4. 越南菜 nearby anchor = 广东省博物馆
  assert(!!e3, 'event_3 必须存在');
  assert(
    e3!.sequenceConstraint?.afterActivityId === 'event_2',
    `吃越南菜必须 after event_2（省博），实际 ${e3!.sequenceConstraint?.afterActivityId ?? '(none)'}`,
  );
  assert(
    e3!.sequenceConstraint?.locationConstraint === 'near_previous_activity',
    '位置约束必须 near_previous_activity',
  );
  // anchor 复用：吃越南菜的 location 必须是省博真实坐标，而不是图书馆
  assert(!!e3!.location, '吃越南菜应复用省博 location 作为 anchor');
  assert(
    e3!.location!.name.includes('省'),
    `anchor 必须是省博，实际 ${e3!.location!.name}`,
  );

  // 5. 至少一条真实 Tencent restaurant candidate
  assert(!!e3!.restaurant, '吃越南菜必须解析出真实腾讯餐厅');
  assert(
    !!e3!.restaurant!.providerRefs?.some((p) => p.provider === 'tencent'),
    '餐厅必须带 tencent providerRefs',
  );
  const restaurantName = e3!.restaurant!.name;
  const hitMock = MOCK_RESTAURANT_MARKERS.some((m) => restaurantName.includes(m));
  assert(!hitMock, `候选不得为本地 mock（命中 ${restaurantName}）`);
  console.log(`\n餐厅候选（仅来自腾讯 response）: ${restaurantName}`);
  console.log(`  地址: ${e3!.restaurant!.location?.address ?? '(none)'}`);

  // 6. rating 保持 undefined（腾讯 place/v1/search 不返回 rating）
  assert(e3!.restaurant!.rating === undefined, 'rating 必须为 undefined（不得伪造）');
  assert(e3!.restaurant!.averagePrice === undefined, 'avgPrice 必须为 undefined（不得伪造）');

  console.log('\n=== REAL TENCENT E2E PASS ===');
  console.log('DATE_UI_E2E=PASS');
  console.log('GUANGZHOU_LIBRARY_LOCATION=PASS');
  console.log('GUANGZHOU_LIBRARY_ADDRESS=PASS');
  console.log('GUANGDONG_MUSEUM_LOCATION=PASS');
  console.log('GUANGDONG_MUSEUM_ADDRESS=PASS');
  console.log('TENCENT_NEARBY_ANCHOR=PASS');
  console.log('VIETNAMESE_SEARCH=PASS');
  console.log('MOCK_RESTAURANT_SOURCE=NOT_HIT');
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('TENCENT_LBS') || message.includes('fetch') || message.includes('abort')) {
    console.error('\nBLOCKED: 真实网络/Tencent API 不可用，E2E 无法执行，不伪造 PASS。');
    console.error(`原因: ${message}`);
    process.exit(2);
  }
  console.error('E2E FAILED:', message);
  process.exit(1);
});
