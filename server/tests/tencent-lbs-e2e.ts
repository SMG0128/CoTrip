// tencent-lbs-e2e.ts
// 本地真实腾讯 LBS E2E（一次性验证脚本，不进入常规测试套件）。
//
// 安全：Key 只从环境变量 TENCENT_MAP_KEY 显式注入；未设置时明确报错，
// 绝不从 frontend config 自动读取。绝不打印 Key / 请求 URL。
//
// 场景（验收 O）：
//   trip.startDate = 2026-09-10
//   input: 「我想早上十点钟到广图，去看书我要看三个小时，去完广图我希望可以去吃泰国菜。」
//
// 验证：
//   - 「广图」解析到广州图书馆真实腾讯 POI（providerPoiId/address/lat/lng）
//   - 看书时间 2026-09-10 10:00–13:00
//   - 用广州图书馆坐标执行 nearby「泰国菜」搜索
//   - 餐厅名称只来自真实 Tencent response
//   - 腾讯未返回的 rating/avgPrice/openingHours 保持 undefined
//   - 不出现 mock/hallucinated restaurant

import { TencentLBSService, PlaceCandidate } from '../src/services/tencent-lbs-service';
import { postProcessTripPlan } from '../src/services/trip-plan-post-processor';
import { TripPlan, TripPlanEvent } from '../src/types/trip-plan';

function getKey(): string {
  const fromEnv = process.env.TENCENT_MAP_KEY?.trim();
  if (fromEnv) return fromEnv;
  // 只允许显式 env 注入真实 Key；绝不从 frontend config 自动读取。
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

async function main(): Promise<void> {
  const key = getKey();
  const lbs = new TencentLBSService({ key });

  console.log('=== REAL TENCENT LBS E2E ===');
  console.log(`key=${mask(key)} (masked)`);

  // 1. POI 解析「广图」→ 广州图书馆
  const poi = await lbs.searchPOI('广州图书馆', '广州市');
  console.log(`\n[1] POI search 广州图书馆 → status=${poi.status}`);
  if (poi.status === 'FOUND') {
    poi.candidates.slice(0, 3).forEach((c) => console.log(`  ${summarizeCandidate(c)}`));
  } else {
    console.log(`  candidates=0 (${poi.status})`);
  }

  // 2. 用广州图书馆坐标做 nearby「泰国菜」搜索
  if (poi.status === 'FOUND' && poi.candidates.length > 0) {
    const anchor = poi.candidates[0];
    const nearby = await lbs.searchNearby('泰国菜', anchor.latitude, anchor.longitude);
    console.log(`\n[2] nearby 泰国菜 @ 广州图书馆 → status=${nearby.status}`);
    if (nearby.status === 'FOUND') {
      nearby.candidates.slice(0, 3).forEach((c) => console.log(`  ${summarizeCandidate(c)}`));
    } else {
      console.log(`  candidates=0 (${nearby.status})`);
    }
  }

  // 3. 完整 post-processor 端到端
  const plan: TripPlan = {
    id: 'plan_e2e',
    tripId: 'trip_e2e',
    version: 1,
    events: [
      {
        id: 'event_1',
        type: 'OTHER',
        title: '去广州图书馆看书',
        time: { start: '2026-09-10T10:00:00+08:00', timezone: 'Asia/Shanghai' },
      },
      {
        id: 'event_2',
        type: 'DINING',
        title: '去完广图吃泰国菜',
        time: { start: '2026-09-10T13:00:00+08:00', timezone: 'Asia/Shanghai' },
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
      commentText: '我想早上十点钟到广图，去看书我要看三个小时，去完广图我希望可以去吃泰国菜。',
      city: '广州市',
    },
    lbs,
  );

  console.log('\n=== POST-PROCESSOR E2E RESULT ===');
  for (const ev of result.plan.events) {
    console.log(`\n[event ${ev.id}] ${ev.title}`);
    console.log(`  time.start=${ev.time?.start ?? '(none)'}`);
    console.log(`  time.end=${ev.time?.end ?? '(none)'}`);
    if (ev.location) {
      console.log(`  location.name=${ev.location.name}`);
      console.log(`  location.poiId=${mask(ev.location.id)}`);
      console.log(`  location.lat=${ev.location.latitude}, lng=${ev.location.longitude}`);
      console.log(`  location.address=${ev.location.address ?? '(none)'}`);
    } else {
      console.log('  location=(none)');
    }
    if (ev.restaurant) {
      console.log(`  restaurant.name=${ev.restaurant.name}`);
      console.log(`  restaurant.poiId=${mask(ev.restaurant.id)}`);
      console.log(`  restaurant.rating=${ev.restaurant.rating?.score ?? '(none)'}`);
      console.log(`  restaurant.avgPrice=${ev.restaurant.averagePrice?.amount ?? '(none)'}`);
    } else {
      console.log('  restaurant=(none)');
    }
  }
}

main().catch((err) => {
  console.error('E2E FAILED:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});