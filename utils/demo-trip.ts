// utils/demo-trip.ts
// 内置示例行程（Demo Trip）：唯一一条本地 Mock 行程，仅用于功能预览与比赛演示。
//
// 规则：
// - 全局 Mock 模式已移除：登录 / 列表 / 创建 / 详情 / 分享 / Join / 持久化全部走真实后端。
// - 示例行程固定 ID（demo-local-trip），与服务端 `trip_<uuid>` 格式不可能冲突。
// - 示例行程不写入后端、不生成真实 roomCode、不进入任何真实 repository；
//   所有会写后端的动作（完成/加入/更新等）由 guardDemoTripWrite 统一阻止并给出提示。
// - 判断一律基于固定 ID 与 source 字段，禁止按标题、creator 昵称等脆弱条件判断。

import { Trip } from '../types/trip';
import { mockActiveTrip } from '../mock/mock-trip';
import { isValidRoomCode, normalizeRoomCode } from './room-code';
import { appConfig } from '../config/auth';

/** 示例行程固定 ID：与服务端 trip_<uuid> 格式无交集 */
export const DEMO_TRIP_ID = 'demo-local-trip';

/** 示例行程被阻止写操作时的统一提示文案 */
export const DEMO_TRIP_BLOCKED_MESSAGE = '示例行程仅用于功能预览，请创建真实行程后使用此功能';

/** 按固定 ID 判断是否为示例行程（唯一权威判断依据） */
export function isDemoTripId(tripId: string | undefined | null): boolean {
  return tripId === DEMO_TRIP_ID;
}

/** 按固定 ID 判断某个行程对象是否为示例行程 */
export function isDemoTrip(trip: { id: string } | null | undefined): boolean {
  return !!trip && isDemoTripId(trip.id);
}

/**
 * 构造唯一的本地示例行程：
 * - 固定 ID + source: 'mock' 标记；
 * - 剥离 roomCode：示例行程绝不参与真实 Join / 分享加入流程
 *   （分享自动走 trip-share 的安全回退——分享首页）;
 * - currentPlan / commentIds / participantIds 做拷贝隔离，
 *   避免页面内规划引擎的本地推导污染 fixture 原始数据。
 */
export function buildDemoTrip(): Trip {
  return {
    ...mockActiveTrip,
    id: DEMO_TRIP_ID,
    source: 'mock',
    roomCode: undefined,
    commentIds: [...mockActiveTrip.commentIds],
    constraintIds: [...mockActiveTrip.constraintIds],
    participantIds: [...mockActiveTrip.participantIds],
    currentPlan: mockActiveTrip.currentPlan
      ? JSON.parse(JSON.stringify(mockActiveTrip.currentPlan))
      : undefined,
  };
}

/** 示例行程列表（受 appConfig.enableDemoTrip 控制；恒为 0 或 1 条，绝不复制多条） */
export function buildDemoTrips(): Trip[] {
  return appConfig.enableDemoTrip ? [buildDemoTrip()] : [];
}

/**
 * 首页列表合并：唯一示例行程置顶 + 真实行程原样保留（最新在前由服务端排序决定）。
 * 真实接口返回 0 条时仍能看到示例行程；返回多条时两者并存。
 * 防御性过滤同 ID 项，保证示例行程在结果中至多出现 1 次。
 */
export function mergeHomeTrips(realTrips: Trip[]): Trip[] {
  const realOnly = (realTrips ?? []).filter((trip) => !isDemoTripId(trip.id));
  return [...buildDemoTrips(), ...realOnly];
}

/**
 * MOCK 小标签是否可见：仅示例行程显示，真实行程永不显示。
 * 判定基于固定 ID，与标题等展示文案无关。
 */
export function shouldShowMockTag(trip: { id: string; source?: Trip['source'] } | null | undefined): boolean {
  return isDemoTrip(trip);
}

/**
 * 写后端动作守卫：示例行程返回提示文案（调用方 toast 展示），真实行程返回 null 放行。
 * 覆盖 completeTrip / join / 更新类等一切会触达真实 API 的动作。
 */
export function guardDemoTripWrite(tripId: string | undefined | null): string | null {
  return isDemoTripId(tripId) ? DEMO_TRIP_BLOCKED_MESSAGE : null;
}

/** 测试辅助：断言示例行程不存在可用于真实 Join 的房间号 */
export function hasUsableRoomCode(trip: Pick<Trip, 'roomCode'>): boolean {
  return isValidRoomCode(normalizeRoomCode(trip.roomCode));
}
