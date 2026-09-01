// Tencent 全局真实地点地址管线测试。
// 全部使用可编程 HTTP stub：验证 search/nearby → reverse geocode → final plan，
// 不依赖地点专用分支，也不访问真实网络。

import assert from 'assert';
import { record } from './run-tests';
import {
  hasCompletePhysicalAddress,
  isResolvedPhysicalLocation,
} from '../src/services/resolved-physical-location';
import { TencentLBSService } from '../src/services/tencent-lbs-service';
import { postProcessTripPlan } from '../src/services/trip-plan-post-processor';
import { sanitizePlanForPersist } from '../src/services/plan-persist-sanitizer';
import { TripPlan, TripPlanEvent } from '../src/types/trip-plan';

const TZ = 'Asia/Shanghai';

interface SearchFixture {
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
}

interface StubOptions {
  searchByKeyword: Record<string, SearchFixture[]>;
  reverseByLocation?: Record<string, string | undefined>;
}

function stubTencent(options: StubOptions): TencentLBSService & { reverseCalls: string[] } {
  const reverseCalls: string[] = [];
  const service = new TencentLBSService({
    key: 'test-key',
    fetchImpl: async (rawUrl) => {
      const url = new URL(rawUrl);
      if (url.pathname.includes('/ws/geocoder/v1/')) {
        const location = url.searchParams.get('location') ?? '';
        reverseCalls.push(location);
        const address = options.reverseByLocation?.[location];
        return {
          ok: true,
          json: async () => ({
            status: 0,
            result: address ? { address } : {},
          }),
        };
      }

      const keyword = url.searchParams.get('keyword') ?? '';
      const fixtures = options.searchByKeyword[keyword] ?? [];
      return {
        ok: true,
        json: async () => ({
          status: 0,
          data: fixtures.map((fixture, index) => ({
            id: `poi_${keyword}_${index}`,
            title: fixture.name,
            ...(fixture.address !== undefined ? { address: fixture.address } : {}),
            location: { lat: fixture.latitude, lng: fixture.longitude },
          })),
        }),
      };
    },
  }) as TencentLBSService & { reverseCalls: string[] };
  service.reverseCalls = reverseCalls;
  return service;
}

function makePlan(event: TripPlanEvent): TripPlan {
  return {
    id: `plan_${event.id}`,
    tripId: 'trip_location_address',
    version: 1,
    events: [event],
    satisfiedConstraintCount: 0,
    totalConstraintCount: 0,
    conflicts: [],
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

function makeEvent(id: string, title: string, type: TripPlanEvent['type'] = 'OTHER'): TripPlanEvent {
  return {
    id,
    type,
    title,
    time: { start: '2026-09-10T10:00:00+08:00', timezone: TZ },
  };
}

export async function runTencentLocationAddressTests(): Promise<void> {
  await record('location invariant: Tencent identity + POI id + name + valid coordinates 才是 resolved', () => {
    const resolved = {
      provider: 'tencent' as const,
      providerPoiId: 'poi_1',
      name: '任意真实地点',
      latitude: 23.12,
      longitude: 113.32,
    };
    assert.strictEqual(isResolvedPhysicalLocation(resolved), true);
    assert.strictEqual(hasCompletePhysicalAddress(resolved), false);
    assert.strictEqual(isResolvedPhysicalLocation({ ...resolved, providerPoiId: '' }), false);
    assert.strictEqual(isResolvedPhysicalLocation({ ...resolved, latitude: 123 }), false);
  });

  await record('table: 任意 activity 的 Tencent search address 原样进入 final location', async () => {
    const cases = [
      { title: '广州图书馆看书', query: '广州图书馆', name: '广州图书馆', address: '腾讯地址-图书馆' },
      { title: '参观广东省博物馆', query: '广东省博物馆', name: '广东省博物馆', address: '腾讯地址-博物馆' },
      { title: '去广州塔', query: '广州塔', name: '广州塔', address: '腾讯地址-广州塔' },
      { title: '在天河体育中心打球', query: '天河体育中心', name: '天河体育中心', address: '腾讯地址-体育中心' },
      { title: '在星河创意园拍照', query: '星河创意园', name: '星河创意园', address: '腾讯地址-任意地点' },
    ];

    for (const [index, item] of cases.entries()) {
      const lbs = stubTencent({
        searchByKeyword: {
          [item.query]: [{ name: item.name, address: item.address, latitude: 23.1, longitude: 113.3 }],
        },
      });
      const result = await postProcessTripPlan(
        {
          plan: makePlan(makeEvent(`event_${index}`, item.title)),
          timeRange: { start: '2026-09-10T09:00:00+08:00', timezone: TZ },
          city: '广州市',
        },
        lbs,
      );
      assert.strictEqual(result.plan.events[0].location?.name, item.name, item.title);
      assert.strictEqual(result.plan.events[0].location?.address, item.address, item.title);
      assert.deepStrictEqual(lbs.reverseCalls, [], 'search 已有 address 时不得额外 reverse geocode');
    }
  });

  await record('search 无 address + 有坐标 → Tencent reverse geocode 补入 final location', async () => {
    const lbs = stubTencent({
      searchByKeyword: {
        云端艺术空间: [{ name: '云端艺术空间', latitude: 23.15, longitude: 113.35 }],
      },
      reverseByLocation: { '23.15,113.35': '腾讯逆地理真实地址' },
    });
    const result = await postProcessTripPlan(
      {
        plan: makePlan(makeEvent('event_reverse', '在云端艺术空间拍照')),
        timeRange: { start: '2026-09-10T09:00:00+08:00', timezone: TZ },
        city: '广州市',
      },
      lbs,
    );
    assert.deepStrictEqual(lbs.reverseCalls, ['23.15,113.35']);
    assert.strictEqual(result.plan.events[0].location?.address, '腾讯逆地理真实地址');
  });

  await record('search 与 reverse 均无 address → final address undefined 且无占位/mock', async () => {
    const lbs = stubTencent({
      searchByKeyword: {
        未知创意空间: [{ name: '未知创意空间', address: '   ', latitude: 23.16, longitude: 113.36 }],
      },
    });
    const result = await postProcessTripPlan(
      {
        plan: makePlan(makeEvent('event_missing', '去未知创意空间')),
        timeRange: { start: '2026-09-10T09:00:00+08:00', timezone: TZ },
        city: '广州市',
      },
      lbs,
    );
    assert.deepStrictEqual(lbs.reverseCalls, ['23.16,113.36']);
    assert.strictEqual(result.plan.events[0].location?.address, undefined);
  });

  await record('table: restaurant / cafe nearby 缺地址时共用 reverse geocode 并进入 final plan', async () => {
    const cases = [
      { title: '去完广州塔吃越南菜', keyword: '越南菜', name: '真实越南餐厅', address: '腾讯逆地理-餐厅' },
      { title: '去完广州塔喝咖啡', keyword: '咖啡', name: '真实咖啡馆', address: '腾讯逆地理-咖啡馆' },
    ];

    for (const [index, item] of cases.entries()) {
      const latitude = 23.2 + index * 0.01;
      const longitude = 113.4 + index * 0.01;
      const locationKey = `${latitude},${longitude}`;
      const lbs = stubTencent({
        searchByKeyword: {
          广州塔: [{ name: '广州塔', address: '腾讯地址-锚点', latitude: 23.1, longitude: 113.3 }],
          [item.keyword]: [{ name: item.name, latitude, longitude }],
        },
        reverseByLocation: { [locationKey]: item.address },
      });
      const result = await postProcessTripPlan(
        {
          plan: makePlan(makeEvent(`event_food_${index}`, item.title, 'DINING')),
          timeRange: { start: '2026-09-10T09:00:00+08:00', timezone: TZ },
          city: '广州市',
        },
        lbs,
      );
      assert.strictEqual(result.plan.events[0].restaurant?.name, item.name);
      assert.strictEqual(result.plan.events[0].restaurant?.location.address, item.address);
      assert.strictEqual(result.plan.events[0].restaurant?.rating, undefined);
      assert.strictEqual(result.plan.events[0].restaurant?.averagePrice, undefined);
    }
  });

  await record('persist sanitizer: verified Tencent address 保留，未验证 AI address fail-closed', () => {
    const verified = makeEvent('event_verified', '参观展览');
    verified.location = {
      id: 'poi_verified',
      name: '真实展馆',
      latitude: 23.1,
      longitude: 113.3,
      address: '腾讯真实地址',
      providerRefs: [{ provider: 'tencent', externalId: 'poi_verified' }],
    };
    const unverified = makeEvent('event_unverified', '参观展览');
    unverified.location = {
      id: 'ai_place',
      name: 'AI 地点',
      latitude: 23.2,
      longitude: 113.4,
      address: 'AI 生成地址',
    };
    const sanitized = sanitizePlanForPersist({
      ...makePlan(verified),
      events: [verified, unverified],
    }, '2026-09-10');
    assert.strictEqual(sanitized.events[0].location?.address, '腾讯真实地址');
    assert.strictEqual(sanitized.events[1].location, undefined);
  });
}
