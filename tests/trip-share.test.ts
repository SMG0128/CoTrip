// tests/trip-share.test.ts
// 行程邀请分享载荷测试（V0.3 Room UI Foundation）：
// - 有 roomCode：标题含行程名，path 指向 join-trip 并携带 roomCode
// - 无 roomCode：不伪造 roomCode，安全回退首页
// - 统一规范化：小写/空白收敛到 Join Landing；畸形代码安全回退
// - 房间号展示 / 复制反馈 / 归一化纯函数

import { Trip } from '../types/trip';
import {
  buildTripSharePayload,
  normalizeRoomCode,
  resolveRoomCodeDisplay,
  roomCopyFeedback,
  ROOM_CODE_PLACEHOLDER,
} from '../utils/trip-share';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

function tripFixture(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip_123',
    title: '顺德一日游',
    status: 'ACTIVE',
    creatorId: 'usr_123',
    participantIds: ['usr_123'],
    createdAt: '2026-08-20T10:00:00.000Z',
    initialBrief: '周末去顺德吃东西',
    commentIds: [],
    constraintIds: [],
    ...overrides,
  };
}

// ---- 1. 有 roomCode：分享加入当前行程 ----
{
  const payload = buildTripSharePayload(tripFixture({ roomCode: '7K4M9XQ' }));
  assert(payload.title.includes('顺德一日游'), '标题必须包含行程名');
  assert(payload.path.startsWith('/pages/join-trip/join-trip'), 'path 必须指向 join-trip 页');
  assert(payload.path.includes('roomCode=7K4M9XQ'), 'path 必须携带 roomCode');
  assert(payload.hasRoomCode === true, 'hasRoomCode 为 true');
}

// ---- 2. roomCode 缺失：不得伪造，安全回退 ----
{
  const payload = buildTripSharePayload(tripFixture());
  assert(!payload.path.includes('roomCode='), '缺失时不得生成任何 roomCode');
  assert(payload.path === '/pages/home/home', '缺失时回退分享首页');
  assert(payload.hasRoomCode === false, 'hasRoomCode 为 false');
  assert(payload.title === '来 CoTrip 一起规划行程', '回退标题不声称加入当前行程');
}

// ---- 3. 小写/空白：统一规范化后汇合到 Join Landing ----
{
  const roomCode = ' 7k4 m9xq ';
  const payload = buildTripSharePayload(tripFixture({ roomCode }));
  assert(
    payload.path === '/pages/join-trip/join-trip?roomCode=7K4M9XQ',
    '小写/空白 roomCode 必须规范化后进入 Join Landing'
  );
  assert(payload.hasRoomCode === true, '规范化后的有效 roomCode 应允许分享加入');
}

// ---- 4. 畸形代码：不得生成不可用的加入链接 ----
{
  const payload = buildTripSharePayload(tripFixture({ roomCode: 'A B&C/?é' }));
  assert(payload.path === '/pages/home/home', '畸形 roomCode 应安全回退首页');
  assert(payload.hasRoomCode === false, '畸形 roomCode 不得声称可加入');
}

// ---- 5. 展示 / 复制反馈 / 归一化 ----
{
  assert(resolveRoomCodeDisplay('7K4M9XQ') === '7K4M9XQ', '有 roomCode 显示原值');
  assert(resolveRoomCodeDisplay(' 7k4 m9xq ') === '7K4M9XQ', '展示值应使用统一规范化');
  assert(resolveRoomCodeDisplay(undefined) === ROOM_CODE_PLACEHOLDER, '无 roomCode 显示待生成');
  assert(resolveRoomCodeDisplay('  ') === ROOM_CODE_PLACEHOLDER, '空白串视为缺失');
  assert(resolveRoomCodeDisplay('INVALID') === ROOM_CODE_PLACEHOLDER, '畸形代码不得作为房间号展示');
  assert(roomCopyFeedback('7K4M9XQ') === '房间号已复制', '复制成功反馈');
  assert(roomCopyFeedback(' 7k4 m9xq ') === '房间号已复制', '复制反馈应使用统一规范化');
  assert(roomCopyFeedback('invalid') === '房间号尚未生成', '畸形代码不得提示复制成功');
  assert(roomCopyFeedback(undefined) === '房间号尚未生成', '缺失时复制反馈');
  assert(normalizeRoomCode(' 7k4 m9xq ') === '7K4M9XQ', '房间号归一化应去空白并转大写');
}

// ---- 6. 绝不伪造：id / userId / timestamp 不产生 roomCode ----
{
  const payload = buildTripSharePayload(tripFixture());
  assert(payload.path === '/pages/home/home', '绝不从 trip.id 等伪造房间号');
}

console.log('✅ trip-share.test.ts 全部通过');
