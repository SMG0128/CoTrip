import { isValidRoomCode, normalizeRoomCode } from './room-code';

export const PENDING_JOIN_ROOM_CODE_STORAGE_KEY = 'cotrip_pending_join_room_code';

function getGlobalData(): IAppOption['globalData'] | null {
  try {
    return getApp<IAppOption>().globalData;
  } catch {
    return null;
  }
}

export function setPendingJoinRoomCode(roomCode: string): void {
  const normalized = normalizeRoomCode(roomCode);
  if (!isValidRoomCode(normalized)) {
    clearPendingJoinRoomCode();
    return;
  }
  const globalData = getGlobalData();
  if (globalData) globalData.pendingJoinRoomCode = normalized;
  wx.setStorageSync(PENDING_JOIN_ROOM_CODE_STORAGE_KEY, normalized);
}

export function getPendingJoinRoomCode(): string | null {
  const globalData = getGlobalData();
  const inMemory = normalizeRoomCode(globalData?.pendingJoinRoomCode);
  if (isValidRoomCode(inMemory)) return inMemory;

  const stored = normalizeRoomCode(
    wx.getStorageSync<string>(PENDING_JOIN_ROOM_CODE_STORAGE_KEY)
  );
  if (!isValidRoomCode(stored)) {
    // 主动修剪旧版本或损坏的邀请上下文，避免每次登录都被无效 pending 干扰。
    if (inMemory || stored) clearPendingJoinRoomCode();
    return null;
  }
  if (globalData) globalData.pendingJoinRoomCode = stored;
  return stored;
}

export function clearPendingJoinRoomCode(): void {
  const globalData = getGlobalData();
  if (globalData) globalData.pendingJoinRoomCode = null;
  wx.removeStorageSync(PENDING_JOIN_ROOM_CODE_STORAGE_KEY);
}
