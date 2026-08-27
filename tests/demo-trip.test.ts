// tests/demo-trip.test.ts
// 内置示例行程（Demo Trip）测试：
// - 全局 Mock 模式已移除：auth / trip 走真实实现；真实行程路线服务临时全局禁用
// - 首页合并：唯一示例行程 + 真实行程并存；真实 0 条时示例仍可见
// - MOCK 标签仅示例行程显示，真实行程永不显示（含标题误导防御）
// - 示例行程写后端动作被守卫阻止；无可用房间号 → 分享安全回退首页

import { Trip } from '../types/trip';
import {
  DEMO_TRIP_ID,
  DEMO_TRIP_BLOCKED_MESSAGE,
  buildDemoTrip,
  guardDemoTripWrite,
  hasUsableRoomCode,
  isDemoTripId,
  mergeHomeTrips,
  shouldShowMockTag,
} from '../utils/demo-trip';
import { buildTripSharePayload } from '../utils/trip-share';
import { authService, routeOptionService, tripService } from '../services/index';
import { RealAuthService } from '../services/real/real-auth-service';
import { RealTripService } from '../services/real/real-trip-service';
import { DisabledRouteOptionService } from '../services/route-option-service';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

let seq = 0;
/** 服务端形态的真实 Trip fixture：id 为 trip_<uuid> 风格，不含 source 标记 */
function realTripFixture(overrides: Partial<Trip> = {}): Trip {
  seq += 1;
  return {
    id: `trip_fixed_uuid_${seq}`,
    title: `真实行程 ${seq}`,
    status: 'ACTIVE',
    creatorId: 'usr_real',
    participantIds: ['usr_real'],
    createdAt: '2026-08-24T09:00:00+08:00',
    initialBrief: '',
    commentIds: [],
    constraintIds: [],
    ...overrides,
  };
}

export async function runDemoTripTests(): Promise<void> {
  const demo = buildDemoTrip();

  // ---- 1. 示例行程身份：固定 ID + source 标记，不可能与服务端 ID 冲突 ----
  assert(isDemoTripId('demo-local-trip'), '固定 ID 判定为示例行程');
  assert(!isDemoTripId('trip_abc123'), '服务端 ID 不判定为示例行程');
  assert(demo.source === 'mock', '示例行程带 source: mock 标记');
  assert(demo.status === 'ACTIVE', '示例行程为进行中状态');

  // ---- 2. 无真实 Trip：首页仅显示 1 条示例行程 ----
  const emptyMerge = mergeHomeTrips([]);
  assert(emptyMerge.length === 1, '无真实 Trip 时首页仅 1 条卡片');
  assert(isDemoTripId(emptyMerge[0].id), '该卡片为示例行程');

  // ---- 3. 有真实 Trip：Mock + Real 并存，Mock 只有 1 条 ----
  const realA = realTripFixture();
  const realB = realTripFixture({ title: '周末爬山' });
  const merged = mergeHomeTrips([realA, realB]);
  assert(merged.length === 3, '示例行程与两条真实行程并存');
  assert(merged.filter((t) => shouldShowMockTag(t)).length === 1, 'MOCK 卡片只有 1 条');
  assert(isDemoTripId(merged[0].id), '示例行程位于列表首位');
  assert(merged.some((t) => t.id === realA.id) && merged.some((t) => t.id === realB.id), '真实行程全部保留');

  // ---- 4. 真实列表混入同 ID 防御：示例行程至多 1 条 ----
  const poisoned = mergeHomeTrips([realTripFixture({ id: DEMO_TRIP_ID })]);
  assert(poisoned.length === 1, '真实列表中的同 ID 项被过滤，不产生重复示例卡');
  assert(isDemoTripId(poisoned[0].id), '保留的是本地构建的示例行程');

  // ---- 5. MOCK 标签：仅示例行程显示，真实行程永不显示（禁止标题等脆弱判断）----
  assert(shouldShowMockTag(demo), '示例行程显示 MOCK 标签');
  assert(shouldShowMockTag(buildDemoTrip()), '重复构建仍判定一致（幂等）');
  assert(!shouldShowMockTag(realA), '真实行程不显示 MOCK 标签');
  assert(
    !shouldShowMockTag(realTripFixture({ title: 'MOCK 演示专用' })),
    '标题包含 MOCK 的真实行程也不显示标签（判断只看 ID）'
  );

  // ---- 6. 写后端动作守卫：示例行程被阻止并给出提示，真实行程放行 ----
  assert(guardDemoTripWrite(DEMO_TRIP_ID) === DEMO_TRIP_BLOCKED_MESSAGE, '示例行程完成/加入/更新类动作被阻止');
  assert(guardDemoTripWrite('trip_abc123') === null, '真实行程写动作放行');
  assert(guardDemoTripWrite(undefined) === null, '缺失 ID 按真实流程处理（由登录/权限层兜底）');

  // ---- 7. 示例行程无可用房间号：分享自动安全回退首页，绝不进入 Join 流程 ----
  assert(!hasUsableRoomCode(demo), '示例行程不存在可用于 Join 的 roomCode');
  const sharePayload = buildTripSharePayload(demo);
  assert(!sharePayload.hasRoomCode, '示例行程分享不带 roomCode');
  assert(sharePayload.path === '/pages/home/home', '示例行程分享安全回退到首页');

  // ---- 8. 登录/行程保持真实；真实行程路线入口全局禁用，禁止误触腾讯 API ----
  assert(authService instanceof RealAuthService, '登录走 RealAuthService');
  assert(tripService instanceof RealTripService, '行程走 RealTripService');
  assert(routeOptionService instanceof DisabledRouteOptionService, '真实行程路线服务使用禁用实现');
  const routeDisabled = await routeOptionService.planRoutes({ destinationName: '任意地点' }).then(
    () => false,
    () => true
  );
  assert(routeDisabled, '禁用实现必须在调用腾讯 Provider 前直接失败');

  // ---- 9. 构建隔离：每次构建独立副本，页面内推导不污染 fixture ----
  const first = buildDemoTrip();
  const second = buildDemoTrip();
  assert(first !== second, '每次返回新对象');
  assert(first.currentPlan !== second.currentPlan, '计划对象已拷贝隔离');
  first.participantIds.push('usr_intruder');
  assert(buildDemoTrip().participantIds.length === second.participantIds.length, '参与者数组不被外部修改污染');

  console.log('✅ demo-trip.test.ts 全部通过');
}
