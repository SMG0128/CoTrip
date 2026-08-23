// 本地多人加入基础测试：
// - roomCode 规范化、预览与 Mock join 行为
// - pendingJoinRoomCode 的内存/本地存储同步与清理
// - 未登录续接、登录后返回邀请页，以及成功/失败导航边界

import { mockDevCurrentUser } from '../mock/mock-user';
import { MockAuthService } from '../services/mock/mock-auth-service';
import { MockTripService, MockTripServiceError } from '../services/mock/mock-trip-service';
import { Trip } from '../types/trip';
import {
  resolveLoginContinuation,
  runJoinAction,
} from '../utils/join-flow';
import {
  clearPendingJoinRoomCode,
  getPendingJoinRoomCode,
  PENDING_JOIN_ROOM_CODE_STORAGE_KEY,
  setPendingJoinRoomCode,
} from '../utils/pending-join';
import { isValidRoomCode, normalizeRoomCode } from '../utils/room-code';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`断言失败: ${message}`);
}

function tripFixture(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip_join_test',
    title: '顺德一日游',
    status: 'ACTIVE',
    roomCode: 'ABCDEFG',
    creatorId: 'creator_user',
    participantIds: ['creator_user'],
    createdAt: '2026-08-24T10:00:00+08:00',
    initialBrief: '本地 join 测试',
    commentIds: [],
    constraintIds: [],
    ...overrides,
  };
}

async function testRoomCodeAndMockJoin(): Promise<void> {
  assert(normalizeRoomCode(' ab c\tdefg ') === 'ABCDEFG', 'roomCode 应移除空白并转大写');
  assert(isValidRoomCode(' ab c defg '), '规范化后的 7 位 roomCode 应有效');
  assert(!isValidRoomCode('ABCDEF'), '非 7 位 roomCode 应无效');

  const active = tripFixture();
  const completed = tripFixture({
    id: 'trip_completed_join_test',
    title: '已结束行程',
    status: 'COMPLETED',
    roomCode: 'QRSTUVW',
  });
  const service = new MockTripService([active, completed], mockDevCurrentUser);

  const preview = await service.getJoinPreview(' ab c defg ');
  assert(preview !== null, '已存在房间应返回 preview');
  assert(preview?.roomCode === 'ABCDEFG', 'preview 应返回规范化后的真实 roomCode');
  assert(preview?.title === '顺德一日游', 'preview 应返回行程标题');
  assert(preview?.participantCount === 1, 'preview 应返回加入前人数');
  assert(preview?.status === 'ACTIVE', 'preview 应返回可用于判断是否可加入的状态');
  assert(await service.getJoinPreview('ZXCVBNM') === null, '不存在的房间应返回 null');
  assert(await service.getJoinPreview('bad') === null, '无效 roomCode 应返回 null');

  const completedPreview = await service.getJoinPreview('qrstuvw');
  assert(completedPreview?.status === 'COMPLETED', '不可加入房间的 preview 应保留非 ACTIVE 状态');
  let notJoinableError: unknown;
  try {
    await service.joinTrip('QRSTUVW');
  } catch (error) {
    notJoinableError = error;
  }
  assert(
    notJoinableError instanceof MockTripServiceError
      && notJoinableError.code === 'TRIP_NOT_JOINABLE',
    '非 ACTIVE 行程 join 应明确失败为 TRIP_NOT_JOINABLE'
  );

  const joined = await service.joinTrip(' abc defg ');
  assert(joined.participantIds.includes(mockDevCurrentUser.id), 'join 应加入当前开发用户');
  assert(joined.participantIds.length === 2, '首次 join 后 participantCount 应增加 1');

  const previewAfterJoin = await service.getJoinPreview('ABCDEFG');
  assert(previewAfterJoin?.participantCount === 2, 'join 后 preview participantCount 应同步增加');

  const joinedAgain = await service.joinTrip('ABCDEFG');
  assert(joinedAgain.participantIds.length === 2, '重复 join 必须幂等，不得重复 participant');
  assert(
    joinedAgain.participantIds.filter((id) => id === mockDevCurrentUser.id).length === 1,
    '当前用户在 participantIds 中只能出现一次'
  );
}

function testPendingJoinContext(): void {
  const storage = new Map<string, unknown>();
  const appGlobalData: IAppOption['globalData'] = {
    currentUser: null,
    pendingJoinRoomCode: null,
  };
  const host = globalThis as unknown as {
    wx?: WechatMiniprogram.Wx;
    getApp?: <T>() => T;
  };
  const originalWx = host.wx;
  const originalGetApp = host.getApp;

  host.wx = {
    setStorageSync(key: string, value: unknown): void {
      storage.set(key, value);
    },
    getStorageSync<T>(key: string): T {
      return storage.get(key) as T;
    },
    removeStorageSync(key: string): void {
      storage.delete(key);
    },
  } as WechatMiniprogram.Wx;
  host.getApp = <T>() => ({ globalData: appGlobalData } as T);

  try {
    setPendingJoinRoomCode(' ab c defg ');
    assert(appGlobalData.pendingJoinRoomCode === 'ABCDEFG', 'pending 应规范化后写入 globalData');
    assert(
      storage.get(PENDING_JOIN_ROOM_CODE_STORAGE_KEY) === 'ABCDEFG',
      'pending 应持久化到统一 storage key'
    );
    assert(getPendingJoinRoomCode() === 'ABCDEFG', 'pending 应可从内存读取');

    setPendingJoinRoomCode('invalid');
    assert(appGlobalData.pendingJoinRoomCode === null, '无效 pending 不得留在 globalData');
    assert(
      !storage.has(PENDING_JOIN_ROOM_CODE_STORAGE_KEY),
      '无效 pending 不得写入本地存储'
    );

    storage.set(PENDING_JOIN_ROOM_CODE_STORAGE_KEY, 'broken');
    appGlobalData.pendingJoinRoomCode = null;
    assert(getPendingJoinRoomCode() === null, '损坏的冷启动 pending 应视为不存在');
    assert(
      !storage.has(PENDING_JOIN_ROOM_CODE_STORAGE_KEY),
      '读取时应主动清理损坏的冷启动 pending'
    );

    setPendingJoinRoomCode('ABCDEFG');

    appGlobalData.pendingJoinRoomCode = null;
    assert(getPendingJoinRoomCode() === 'ABCDEFG', '冷启动时 pending 应可从 storage 恢复');
    assert(appGlobalData.pendingJoinRoomCode === 'ABCDEFG', 'storage 恢复值应同步回 globalData');

    clearPendingJoinRoomCode();
    assert(appGlobalData.pendingJoinRoomCode === null, 'clear 应清空 globalData pending');
    assert(!storage.has(PENDING_JOIN_ROOM_CODE_STORAGE_KEY), 'clear 应删除持久化 pending');
    assert(getPendingJoinRoomCode() === null, 'clear 后 get 应返回 null');
  } finally {
    if (originalWx) host.wx = originalWx;
    else delete host.wx;
    if (originalGetApp) host.getApp = originalGetApp;
    else delete host.getApp;
  }
}

async function testJoinActionAndLoginContinuation(): Promise<void> {
  let pending = '';
  let loginNavigations = 0;
  let joinCalls = 0;
  let detailTripId = '';
  let clearCalls = 0;

  const loginRequired = await runJoinAction({
    roomCode: ' ab c defg ',
    currentUser: null,
    joinTrip: async () => {
      joinCalls += 1;
      return tripFixture();
    },
    savePending: (roomCode) => { pending = roomCode; },
    clearPending: () => { clearCalls += 1; },
    goToLogin: () => { loginNavigations += 1; },
    goToTripDetail: (tripId) => { detailTripId = tripId; },
  });
  assert(loginRequired === 'LOGIN_REQUIRED', '未登录 join 应返回 LOGIN_REQUIRED');
  assert(pending === 'ABCDEFG', '未登录 join 应先保存规范化 roomCode');
  assert(loginNavigations === 1, '未登录 join 应导航到登录页');
  assert(joinCalls === 0, '未登录时不得自动调用 joinTrip');
  assert(!detailTripId && clearCalls === 0, '未登录时不得进入详情或清除邀请上下文');

  const continuation = resolveLoginContinuation(pending);
  assert(continuation.kind === 'join', '登录成功后有 pending 应返回邀请页');
  assert(
    continuation.url === '/pages/join-trip/join-trip?roomCode=ABCDEFG',
    '登录续接必须保留同一 roomCode，且不得自动 join'
  );
  const defaultContinuation = resolveLoginContinuation('invalid');
  assert(defaultContinuation.kind === 'home', '无有效 pending 时登录成功应回首页');

  const joined = await runJoinAction({
    roomCode: 'abcdefg',
    currentUser: mockDevCurrentUser,
    joinTrip: async (roomCode) => {
      joinCalls += 1;
      assert(roomCode === 'ABCDEFG', '已登录 join 应向 service 传规范化 roomCode');
      return tripFixture({ id: 'trip_joined' });
    },
    savePending: () => { throw new Error('已登录时不应保存 pending'); },
    clearPending: () => { clearCalls += 1; },
    goToLogin: () => { throw new Error('已登录时不应去登录页'); },
    goToTripDetail: (tripId) => { detailTripId = tripId; },
  });
  assert(joined === 'JOINED', 'service 成功返回 Trip 后应返回 JOINED');
  assert(detailTripId === 'trip_joined', 'join 成功必须按 service 返回的 trip.id 导航详情');
  assert(clearCalls === 1, 'join 成功后应清除 pending 上下文');

  let failedNavigation = '';
  let failedClearCalls = 0;
  let joinFailure: unknown;
  try {
    await runJoinAction({
      roomCode: 'ABCDEFG',
      currentUser: mockDevCurrentUser,
      joinTrip: async () => { throw new Error('JOIN_FAILED'); },
      savePending: () => undefined,
      clearPending: () => { failedClearCalls += 1; },
      goToLogin: () => undefined,
      goToTripDetail: (tripId) => { failedNavigation = tripId; },
    });
  } catch (error) {
    joinFailure = error;
  }
  assert(joinFailure instanceof Error && joinFailure.message === 'JOIN_FAILED', 'join failure 应向上抛出');
  assert(!failedNavigation, 'join failure 时绝不能导航到行程详情');
  assert(failedClearCalls === 0, 'join failure 时应保留 pending 上下文供重试');
}

async function testMockLogoutColdStart(): Promise<void> {
  const storage = new Map<string, unknown>();
  const host = globalThis as unknown as { wx?: WechatMiniprogram.Wx };
  const originalWx = host.wx;
  host.wx = {
    setStorageSync(key: string, value: unknown): void {
      storage.set(key, value);
    },
    getStorageSync<T>(key: string): T {
      return storage.get(key) as T;
    },
    removeStorageSync(key: string): void {
      storage.delete(key);
    },
  } as WechatMiniprogram.Wx;

  try {
    const auth = new MockAuthService();
    assert((await auth.restoreSession())?.user.id === mockDevCurrentUser.id, 'Mock 初始可恢复开发用户');
    await auth.logout();
    assert(await auth.restoreSession() === null, 'Mock 退出后冷启动必须保持未登录');
    await auth.login();
    assert((await auth.restoreSession())?.user.id === mockDevCurrentUser.id, '重新登录后应恢复开发用户');
  } finally {
    if (originalWx) host.wx = originalWx;
    else delete host.wx;
  }
}

export async function runJoinFlowTests(): Promise<void> {
  await testRoomCodeAndMockJoin();
  testPendingJoinContext();
  await testJoinActionAndLoginContinuation();
  await testMockLogoutColdStart();
  console.log('✅ join-flow.test.ts 全部通过');
}
