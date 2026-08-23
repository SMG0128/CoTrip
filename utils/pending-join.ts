import { normalizeRoomCode } from './room-code';

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
  if (!normalized) {
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
  if (inMemory) return inMemory;

  const stored = normalizeRoomCode(
    wx.getStorageSync<string>(PENDING_JOIN_ROOM_CODE_STORAGE_KEY)
  );
  if (!stored) return null;
  if (globalData) globalData.pendingJoinRoomCode = stored;
  return stored;
}

export function clearPendingJoinRoomCode(): void {
  const globalData = getGlobalData();
  if (globalData) globalData.pendingJoinRoomCode = null;
  wx.removeStorageSync(PENDING_JOIN_ROOM_CODE_STORAGE_KEY);
}
