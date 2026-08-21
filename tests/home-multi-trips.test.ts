// tests/home-multi-trips.test.ts
// 多进行中 Trip 支持测试（V0.3 Part D）：
// - 连续创建 Trip A / Trip B 后，listActiveTrips 必须同时保留两者
// - 最新创建在前（B 在 A 前）
// - 首页展示依赖整个列表，而不是 trips[0]

import { MockTripService } from '../services/mock/mock-trip-service';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

export async function runHomeMultiTripsTests(): Promise<void> {
  // 连续创建两个进行中 Trip
  const service = new MockTripService();
  const tripA = await service.createTrip({ title: '行程 A', creatorId: 'usr_test', initialBrief: '' });
  const tripB = await service.createTrip({ title: '行程 B', creatorId: 'usr_test', initialBrief: '' });

  const active = await service.listActiveTrips();

  // 两个 Trip 都必须被保留，不允许只展示最新的一个
  assert(active.some((t) => t.title === '行程 A'), '较旧的 Trip A 必须仍然可见（不允许仅 trips[0]）');
  assert(active.some((t) => t.title === '行程 B'), '较新的 Trip B 必须可见');
  assert(active.length >= 2, 'listActiveTrips 必须返回全部进行中 Trip');
  assert(new Set(active.map((t) => t.id)).size === active.length, '同一毫秒连建也不得产生重复 id');

  // 顺序：最新在前（B 后创建，须排在 A 之前）
  const titles = active.map((t) => t.title);
  assert(titles[0] === '行程 B', '最新创建的 Trip B 位于列表最前');
  assert(titles.indexOf('行程 B') < titles.indexOf('行程 A'), 'Trip B 应排在 Trip A 之前');

  console.log('✅ home-multi-trips.test.ts 全部通过');
}
