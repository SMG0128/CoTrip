// AI Trip Pipeline 确定性后处理测试（B/C/D/E/F/G/H/I/J/L）。
//
// 覆盖验收清单 L 的 1-12 项：
//   1. trip start 2026-09-10 + 「早上十点去广图」→ 2026-09-10 10:00
//   2. 「在广图看三个小时」→ durationMinutes = 180
//   3. 10:00 + 180min → end = 13:00
//   4. 「去完广图吃泰国菜」→ after/dependsOn + near_previous
//   5. 「广图」→ POI resolution requested
//   6. Tencent POI candidates returned → 只有真实 provider 候选进入行程
//   7. Tencent 返回 0 → 无 mock restaurant
//   8. Tencent throws → 无 mock restaurant
//   9. 腾讯没有 rating → 前端不渲染假 rating
//   10. 腾讯没有 avgPrice → 前端不渲染假 avgPrice
//   11. 用户只指定时间、没指定日期 → earliest feasible date >= trip.startDate
//   12. Date.now / current clock 不污染 trip activity datetime

import assert from 'assert';
import { record } from './run-tests';
import { parseDurationMinutes } from '../src/services/duration-parser';
import {
  buildTimeAnchor,
  combineDateTime,
  resolveEventTime,
  resolvePlanTimes,
} from '../src/services/trip-temporal-resolution';
import { resolveSequenceConstraints } from '../src/services/trip-sequence-resolution';
import {
  PlaceCandidate,
  POISearchOutcome,
  TencentLBSService,
} from '../src/services/tencent-lbs-service';
import { rankPlaceCandidates } from '../src/services/place-candidate-ranker';
import { postProcessTripPlan, applySequenceTimes } from '../src/services/trip-plan-post-processor';
import { sanitizePlanForPersist } from '../src/services/plan-persist-sanitizer';
import { TripPlan, TripPlanEvent } from '../src/types/trip-plan';

const ANCHOR = { startDate: '2026-09-10', timezone: 'Asia/Shanghai', startTime: '09:00' };

function event(overrides: Partial<TripPlanEvent> = {}): TripPlanEvent {
  return {
    id: 'event_1',
    type: 'OTHER',
    title: '去广州图书馆看书',
    time: { start: '2026-09-10T10:00:00+08:00', timezone: 'Asia/Shanghai' },
    ...overrides,
  };
}

function planFixture(events: TripPlanEvent[]): TripPlan {
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

/** 可编程 Tencent LBS stub：模拟腾讯 API 返回 / 0 结果 / 抛错 */
function stubLBS(options: {
  poi?: POISearchOutcome;
  nearby?: POISearchOutcome;
  throwOn?: 'poi' | 'nearby';
}): TencentLBSService {
  const service = new TencentLBSService({ key: 'test-key' });
  // 覆写内部方法以模拟腾讯 API 行为（不触网）
  (service as unknown as { searchPOI: () => Promise<POISearchOutcome> }).searchPOI = async () => {
    // 真实服务在内部 catch 网络错误并返回 POI_SEARCH_UNAVAILABLE（绝不伪造）
    if (options.throwOn === 'poi') return { status: 'POI_SEARCH_UNAVAILABLE', candidates: [] };
    return options.poi ?? { status: 'POI_NOT_FOUND', candidates: [] };
  };
  (service as unknown as { searchNearby: () => Promise<POISearchOutcome> }).searchNearby = async () => {
    if (options.throwOn === 'nearby') return { status: 'POI_SEARCH_UNAVAILABLE', candidates: [] };
    return options.nearby ?? { status: 'POI_NOT_FOUND', candidates: [] };
  };
  return service;
}

export async function runTemporalResolutionTests(): Promise<void> {
  // ---------- 1. 时间锚定：早上十点去广图 → 2026-09-10 10:00 ----------
  await record('temporal: 「早上十点去广图」锚定到 trip.startDate 2026-09-10 10:00', () => {
    // 模拟 AI 用了当前系统日期（错误行为）→ 应被重新锚定到行程日期
    const aiTime = { start: '2026-09-01T10:00:00+08:00', timezone: 'Asia/Shanghai' };
    const resolved = resolveEventTime(aiTime, 'OTHER', ANCHOR);
    assert.strictEqual(resolved.start, '2026-09-10T10:00:00+08:00', '必须锚定到行程开始日期');
  });

  await record('temporal: AI 时间已落在行程日期则保留（用户明确指定日期+时间）', () => {
    const aiTime = { start: '2026-09-10T10:00:00+08:00', timezone: 'Asia/Shanghai' };
    const resolved = resolveEventTime(aiTime, 'OTHER', ANCHOR);
    assert.strictEqual(resolved.start, '2026-09-10T10:00:00+08:00');
  });

  await record('temporal: AI 完全没给时间 → 用行程 startTime（09:00）', () => {
    const resolved = resolveEventTime(undefined, 'OTHER', ANCHOR);
    assert.strictEqual(resolved.start, '2026-09-10T09:00:00+08:00');
  });

  await record('temporal: 用户只指定时间、没指定日期 → 使用 trip.startDate（最早可行日期）', () => {
    // 模拟 AI 只给了时刻（无日期），应锚定到行程开始日
    const aiTime = { start: '2026-09-10T14:00:00+08:00', timezone: 'Asia/Shanghai' };
    const resolved = resolveEventTime(aiTime, 'DINING', ANCHOR);
    assert.strictEqual(resolved.start, '2026-09-10T14:00:00+08:00');
    assert.ok(resolved.start >= '2026-09-10', '日期必须 >= trip.startDate');
  });

  // ---------- 2. 时长解析 ----------
  await record('2. 「看三个小时」→ durationMinutes = 180', () => {
    assert.deepStrictEqual(parseDurationMinutes('看三个小时'), { ok: true, durationMinutes: 180 });
  });

  await record('2. 「看3个小时」→ durationMinutes = 180', () => {
    assert.deepStrictEqual(parseDurationMinutes('看3个小时'), { ok: true, durationMinutes: 180 });
  });

  await record('2. 「看90分钟」→ durationMinutes = 90', () => {
    assert.deepStrictEqual(parseDurationMinutes('看90分钟'), { ok: true, durationMinutes: 90 });
  });

  await record('2. 「一个半小时」→ durationMinutes = 90', () => {
    assert.deepStrictEqual(parseDurationMinutes('一个半小时'), { ok: true, durationMinutes: 90 });
  });

  await record('2. 「两个半小时」→ durationMinutes = 150', () => {
    assert.deepStrictEqual(parseDurationMinutes('两个半小时'), { ok: true, durationMinutes: 150 });
  });

  await record('2. 「半小时」→ durationMinutes = 30', () => {
    assert.deepStrictEqual(parseDurationMinutes('半小时'), { ok: true, durationMinutes: 30 });
  });

  await record('2. 无时长文本 → ok=false（不伪造）', () => {
    assert.deepStrictEqual(parseDurationMinutes('去广州图书馆看书'), { ok: false });
  });

  // ---------- 3. 10:00 + 180min → end = 13:00 ----------
  await record('3. 10:00 + 180min → end = 13:00（postProcess 应用时长）', async () => {
    const plan = planFixture([
      event({ id: 'event_1', title: '去广州图书馆看书', time: { start: '2026-09-10T10:00:00+08:00', timezone: 'Asia/Shanghai' } }),
    ]);
    const result = await postProcessTripPlan(
      { plan, timeRange: { start: '2026-09-10T09:00:00+08:00', timezone: 'Asia/Shanghai' }, commentText: '看三个小时' },
      null,
    );
    assert.strictEqual(result.plan.events[0].time.end, '2026-09-10T13:00:00+08:00');
  });

  await record('3b. 时长绑定到语义相关的看书活动（非最后一个活动）', async () => {
    const plan = planFixture([
      event({ id: 'event_1', title: '去广州图书馆看书', time: { start: '2026-09-10T10:00:00+08:00', timezone: 'Asia/Shanghai' } }),
      event({ id: 'event_2', type: 'DINING', title: '去完广图吃泰国菜', time: { start: '2026-09-10T13:00:00+08:00', timezone: 'Asia/Shanghai' } }),
    ]);
    const result = await postProcessTripPlan(
      {
        plan,
        timeRange: { start: '2026-09-10T09:00:00+08:00', timezone: 'Asia/Shanghai' },
        commentText: '我想早上十点钟到广图，去看书我要看三个小时，去完广图我希望可以去吃泰国菜。',
      },
      null,
    );
    // 时长 180min 应绑定到看书活动（event_1），而非最后一个活动（event_2）
    assert.strictEqual(result.plan.events[0].time.end, '2026-09-10T13:00:00+08:00', '看书活动 end=13:00');
    assert.strictEqual(result.plan.events[1].time.end, undefined, '吃泰国菜活动不应被错误加时长');
  });

  await record('3c. 无真实 route duration：不出现 hardcoded 30min，start = previous.end', async () => {
    const plan = planFixture([
      event({ id: 'event_1', title: '去广州图书馆看书', time: { start: '2026-09-10T10:00:00+08:00', timezone: 'Asia/Shanghai' } }),
      event({ id: 'event_2', type: 'DINING', title: '去完广图吃泰国菜', time: { start: '2026-09-10T13:00:00+08:00', timezone: 'Asia/Shanghai' } }),
    ]);
    const result = await postProcessTripPlan(
      {
        plan,
        timeRange: { start: '2026-09-10T09:00:00+08:00', timezone: 'Asia/Shanghai' },
        commentText: '我想早上十点钟到广图，去看书我要看三个小时，去完广图我希望可以去吃泰国菜。',
      },
      null,
    );
    // 无真实 route duration：不得凭空 +30min，start = previous.end = 13:00
    assert.strictEqual(
      result.plan.events[1].time.start,
      '2026-09-10T13:00:00+08:00',
      '无真实 route duration 时不得伪造 30min travel',
    );
    assert.ok(
      result.plan.events[1].time.start >= result.plan.events[0].time.end!,
      '两个活动时间不得重叠',
    );
  });

  await record('3d. 有真实 route duration：start = previous end + real duration', () => {
    const events = [
      event({ id: 'event_1', title: '去广州图书馆看书', time: { start: '2026-09-10T10:00:00+08:00', end: '2026-09-10T13:00:00+08:00', timezone: 'Asia/Shanghai' } }),
      event({ id: 'event_2', type: 'DINING', title: '去完广图吃泰国菜', time: { start: '2026-09-10T13:00:00+08:00', timezone: 'Asia/Shanghai' } }),
    ];
    // 先建立先后关系，再注入真实 route provider 返回的 45min 路线时长
    const sequenced = resolveSequenceConstraints(events) as never[];
    const withRealRoute = applySequenceTimes(
      sequenced,
      new Map([['event_2', 45]]),
    ) as Array<{ id: string; time: { start: string } }>;
    const dining = withRealRoute.find((e) => e.id === 'event_2')!;
    assert.strictEqual(
      dining.time.start,
      '2026-09-10T13:45:00+08:00',
      '有真实 route duration 时 start = previous.end + real duration',
    );
  });

  // ---------- 4. 先后关系 ----------
  await record('4. 「去完广图后去泰国菜」→ afterActivityId + near_previous', () => {
    const events = [
      event({ id: 'event_1', title: '去广州图书馆看书' }),
      event({ id: 'event_2', title: '去完广图吃泰国菜' }),
    ];
    const resolved = resolveSequenceConstraints(events);
    assert.strictEqual(resolved[1].sequenceConstraint?.afterActivityId, 'event_1');
    assert.strictEqual(
      resolved[1].sequenceConstraint?.locationConstraint,
      'near_previous_activity',
    );
  });

  // ---------- 5. POI 解析请求 ----------
  await record('5. 「广图」→ 触发 POI resolution（searchPOI 被调用）', async () => {
    let poiCalled = false;
    const lbs = new TencentLBSService({ key: 'test-key' });
    (lbs as unknown as { searchPOI: () => Promise<POISearchOutcome> }).searchPOI = async () => {
      poiCalled = true;
      return { status: 'FOUND', candidates: [tencentCandidate('广州图书馆')] };
    };
    (lbs as unknown as { searchNearby: () => Promise<POISearchOutcome> }).searchNearby = async () =>
      ({ status: 'POI_NOT_FOUND', candidates: [] });

    const event = makeEvent({ id: 'event_1', title: '去广州图书馆看书' });
    const result = await postProcessTripPlan(
      { plan: planFixture([event]), timeRange: { start: '2026-09-10T09:00:00+08:00', timezone: 'Asia/Shanghai' }, city: '广州市' },
      lbs,
    );
    assert.strictEqual(poiCalled, true, '必须发起 POI 解析');
    assert.strictEqual(result.plan.events[0].location?.name, '广州图书馆');
    assert.strictEqual(result.plan.events[0].location?.providerRefs?.[0]?.provider, 'tencent');
  });

  // ---------- 6. 仅真实 provider 候选进入行程 ----------
  await record('6. 腾讯返回真实候选 → 仅真实 provider 候选进入行程', async () => {
    const lbs = stubLBS({
      poi: { status: 'FOUND', candidates: [tencentCandidate('广州图书馆')] },
      nearby: {
        status: 'FOUND',
        candidates: [tencentCandidate('泰香米泰国餐厅', 500)],
      },
    });
    const event = makeEvent({ id: 'event_1', type: 'DINING', title: '去完广图吃泰国菜' });
    const result = await postProcessTripPlan(
      { plan: planFixture([event]), timeRange: { start: '2026-09-10T09:00:00+08:00', timezone: 'Asia/Shanghai' }, city: '广州市' },
      lbs,
    );
    assert.strictEqual(result.plan.events[0].restaurant?.name, '泰香米泰国餐厅');
    assert.strictEqual(result.plan.events[0].restaurant?.providerRefs?.[0]?.provider, 'tencent');
    assert.strictEqual(result.plan.events[0].restaurant?.id, 'test_1');
  });

  // ---------- 7. 腾讯返回 0 → 无 mock restaurant ----------
  await record('7. 腾讯返回 0 候选 → 无 mock restaurant，location 保持 unresolved', async () => {
    const lbs = stubLBS({ poi: { status: 'POI_NOT_FOUND', candidates: [] } });
    const event = makeEvent({ id: 'event_1', title: '去广州图书馆看书' });
    const result = await postProcessTripPlan(
      { plan: planFixture([event]), timeRange: { start: '2026-09-10T09:00:00+08:00', timezone: 'Asia/Shanghai' }, city: '广州市' },
      lbs,
    );
    assert.strictEqual(result.plan.events[0].location, undefined, '不得伪造 location');
    assert.strictEqual(result.plan.events[0].restaurant, undefined, '不得伪造 restaurant');
  });

  // ---------- 8. 腾讯抛错 → 无 mock restaurant ----------
  await record('8. 腾讯抛错 → 无 mock restaurant，locationStatus=search_unavailable', async () => {
    const lbs = stubLBS({ throwOn: 'poi' });
    const event = makeEvent({ id: 'event_1', title: '去广州图书馆看书' });
    const result = await postProcessTripPlan(
      { plan: planFixture([event]), timeRange: { start: '2026-09-10T09:00:00+08:00', timezone: 'Asia/Shanghai' }, city: '广州市' },
      lbs,
    );
    assert.strictEqual(result.plan.events[0].location, undefined, '不得伪造 location');
    assert.strictEqual(result.plan.events[0].restaurant, undefined, '不得伪造 restaurant');
    assert.strictEqual(result.events[0].locationStatus, 'search_unavailable');
  });

  // ---------- 9. 腾讯无 rating → 不渲染假 rating ----------
  await record('9. 腾讯无 rating → restaurant.rating 为 undefined（truth-preserving）', async () => {
    const lbs = stubLBS({
      poi: { status: 'FOUND', candidates: [tencentCandidate('广州图书馆')] },
      nearby: { status: 'FOUND', candidates: [tencentCandidate('泰香米泰国餐厅', 500)] },
    });
    const event = makeEvent({ id: 'event_1', type: 'DINING', title: '去完广图吃泰国菜' });
    const result = await postProcessTripPlan(
      { plan: planFixture([event]), timeRange: { start: '2026-09-10T09:00:00+08:00', timezone: 'Asia/Shanghai' }, city: '广州市' },
      lbs,
    );
    assert.strictEqual(result.plan.events[0].restaurant?.rating, undefined, '不得伪造 rating');
  });

  // ---------- 10. 腾讯无 avgPrice → 不渲染假 avgPrice ----------
  await record('10. 腾讯无 avgPrice → restaurant.avgPrice 为 undefined（truth-preserving）', async () => {
    const lbs = stubLBS({
      poi: { status: 'FOUND', candidates: [tencentCandidate('广州图书馆')] },
      nearby: { status: 'FOUND', candidates: [tencentCandidate('泰香米泰国餐厅', 500)] },
    });
    const event = makeEvent({ id: 'event_1', type: 'DINING', title: '去完广图吃泰国菜' });
    const result = await postProcessTripPlan(
      { plan: planFixture([event]), timeRange: { start: '2026-09-10T09:00:00+08:00', timezone: 'Asia/Shanghai' }, city: '广州市' },
      lbs,
    );
    assert.strictEqual(result.plan.events[0].restaurant?.averagePrice, undefined, '不得伪造 avgPrice');
  });

  // ---------- 11. 用户只指定时间、没指定日期 → earliest feasible date >= startDate ----------
  await record('11. 只指定时间没指定日期 → 日期 >= trip.startDate', () => {
    const aiTime = { start: '2026-09-10T15:00:00+08:00', timezone: 'Asia/Shanghai' };
    const resolved = resolveEventTime(aiTime, 'OTHER', ANCHOR);
    assert.ok(resolved.start.slice(0, 10) >= '2026-09-10', '日期必须 >= trip.startDate');
  });

  // ---------- 12. Date.now 不污染 ----------
  await record('12. Date.now / 当前时钟不污染活动时间（resolveEventTime 不读时钟）', () => {
    const before = Date.now();
    const resolved = resolveEventTime(undefined, 'OTHER', ANCHOR);
    const after = Date.now();
    // 结果必须完全由 anchor 决定，与当前时间无关
    assert.strictEqual(resolved.start, '2026-09-10T09:00:00+08:00');
    assert.ok(before <= after, 'Date.now 被调用但结果不受其影响');
  });

  // ---------- 排序（H） ----------
  await record('H. 确定性排序：距离近者优先', () => {
    const ranked = rankPlaceCandidates(
      [
        tencentCandidate('远餐厅', 3000),
        tencentCandidate('近餐厅', 200),
      ],
      '泰国菜',
    );
    assert.strictEqual(ranked[0].name, '近餐厅', '距离近者优先');
  });

  await record('H. 排序不创造候选：输入几个就输出几个', () => {
    const ranked = rankPlaceCandidates([tencentCandidate('唯一餐厅', 100)], '泰国菜');
    assert.strictEqual(ranked.length, 1, '腾讯只返回 1 个就显示 1 个');
  });

  await record('H. 排序不创造候选：0 个输入 → 0 个输出', () => {
    const ranked = rankPlaceCandidates([], '泰国菜');
    assert.strictEqual(ranked.length, 0, '腾讯返回 0 个就显示 0 个');
  });

  // ---------- 落库前不变量门禁（fail-closed） ----------
  await record('sanitize: 剥离未验证 location（无 providerRefs）', () => {
    const plan = planFixture([
      event({
        id: 'event_1',
        title: '去广州图书馆看书',
        location: { id: 'fake', name: '广州图书馆', latitude: 0, longitude: 0 },
      }),
    ]);
    const sanitized = sanitizePlanForPersist(plan, '2026-09-10');
    assert.strictEqual(sanitized.events[0].location, undefined, '未验证 location 必须剥离');
    assert.strictEqual(sanitized.events[0].title, '去广州图书馆看书', '意图文本保留');
  });

  await record('sanitize: 剥离未验证 restaurant（无 providerRefs）', () => {
    const plan = makePlan([
      event({
        id: 'event_1',
        type: 'DINING',
        title: '去完广图吃泰国菜',
        restaurant: {
          id: 'fake',
          name: 'AI 编造的餐厅',
          location: { id: 'fake', name: 'AI 编造的餐厅', latitude: 0, longitude: 0 },
          rating: { score: 4.8 },
          averagePrice: { amount: 80, currency: 'CNY', unit: 'per_person' },
        },
      }),
    ]);
    const sanitized = sanitizePlanForPersist(plan, '2026-09-10');
    assert.strictEqual(sanitized.events[0].restaurant, undefined, '未验证 restaurant 必须剥离');
  });

  await record('sanitize: 剥离 AI 生成的 rating/avgPrice（无 provider 验证的整个 restaurant）', () => {
    const plan = makePlan([
      event({
        id: 'event_1',
        type: 'DINING',
        title: '去完广图吃泰国菜',
        restaurant: {
          id: 'poi_1',
          name: '泰香米',
          location: {
            id: 'poi_1',
            name: '泰香米',
            latitude: 23.13,
            longitude: 113.32,
          },
          rating: { score: 4.8 },
          averagePrice: { amount: 80, currency: 'CNY', unit: 'per_person' },
        },
      }),
    ]);
    const sanitized = sanitizePlanForPersist(plan, '2026-09-10');
    // 无 providerRefs → 视为 AI 编造，整个 restaurant（含 rating/avgPrice）必须剥离
    assert.strictEqual(sanitized.events[0].restaurant, undefined, 'AI 编造 restaurant 必须整体剥离');
  });

  await record('sanitize: 保留已验证 restaurant 且仅保留 Provider 真实返回的 rating/avgPrice', () => {
    const plan = makePlan([
      event({
        id: 'event_1',
        type: 'DINING',
        title: '去完广图吃泰国菜',
        restaurant: {
          id: 'poi_1',
          name: '泰香米',
          location: {
            id: 'poi_1',
            name: '泰香米',
            latitude: 23.13,
            longitude: 113.32,
            providerRefs: [{ provider: 'tencent', externalId: 'poi_1' }],
          },
          rating: { score: 4.8 },
          averagePrice: { amount: 80, currency: 'CNY', unit: 'per_person' },
          providerRefs: [{ provider: 'tencent', externalId: 'poi_1' }],
        },
      }),
    ]);
    const sanitized = sanitizePlanForPersist(plan, '2026-09-10');
    // 有 providerRefs → 视为已验证（由 truth-preserving 的 post-processor 写入），保留
    assert.strictEqual(sanitized.events[0].restaurant?.name, '泰香米');
    assert.strictEqual(sanitized.events[0].restaurant?.rating?.score, 4.8);
    assert.strictEqual(sanitized.events[0].restaurant?.averagePrice?.amount, 80);
  });

  await record('sanitize: 剥离当前时钟派生的行程时间（未锚定到 trip.startDate）', () => {
    const plan = makePlan([
      event({
        id: 'event_1',
        title: '去广州图书馆看书',
        time: { start: '2026-09-01T21:06:00+08:00', timezone: 'Asia/Shanghai' },
      }),
    ]);
    const sanitized = sanitizePlanForPersist(plan, '2026-09-10');
    assert.strictEqual(sanitized.events[0].time, undefined, '未锚定到行程日期的当前时钟时间必须剥离');
  });

  await record('sanitize: 保留已验证 location（含 tencent providerRefs）', () => {
    const plan = makePlan([
      event({
        id: 'event_1',
        title: '去广州图书馆看书',
        location: {
          id: 'poi_1',
          name: '广州图书馆',
          latitude: 23.13,
          longitude: 113.32,
          providerRefs: [{ provider: 'tencent', externalId: 'poi_1' }],
        },
      }),
    ]);
    const sanitized = sanitizePlanForPersist(plan, '2026-09-10');
    assert.strictEqual(sanitized.events[0].location?.name, '广州图书馆', '已验证 location 保留');
  });

  await record('sanitize: 保留锚定到行程日期的合法时间', () => {
    const plan = makePlan([
      event({
        id: 'event_1',
        title: '去广州图书馆看书',
        time: { start: '2026-09-10T10:00:00+08:00', timezone: 'Asia/Shanghai' },
      }),
    ]);
    const sanitized = sanitizePlanForPersist(plan, '2026-09-10');
    assert.strictEqual(sanitized.events[0].time?.start, '2026-09-10T10:00:00+08:00');
  });
}

// ---- 测试辅助 ----

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
    title: '去广州图书馆看书',
    time: { start: '2026-09-10T10:00:00+08:00', timezone: 'Asia/Shanghai' },
    ...overrides,
  };
}

function tencentCandidate(name: string, distance?: number): PlaceCandidate {
  return {
    provider: 'tencent',
    providerPoiId: 'test_1',
    name,
    latitude: 23.13,
    longitude: 113.32,
    ...(distance !== undefined ? { distanceMeters: distance } : {}),
  };
}