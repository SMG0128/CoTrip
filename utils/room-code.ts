// 房间码输入边界：只负责本地格式归一化与校验，不生成房间码。

export const ROOM_CODE_LENGTH = 7;
const ROOM_CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{7}$/;

/** 去除全部空白并转大写，便于手输、粘贴和分享参数统一匹配。 */
export function normalizeRoomCode(roomCode: string | undefined | null): string {
  return (roomCode ?? '').replace(/\s+/g, '').toUpperCase();
}

export function isValidRoomCode(roomCode: string | undefined | null): boolean {
  return ROOM_CODE_PATTERN.test(normalizeRoomCode(roomCode));
}

/** 安全解析微信页面参数；非法 URI 编码不会导致页面白屏。 */
export function parseRoomCodeParam(raw: string | undefined): string {
  const value = raw ?? '';
  try {
    return normalizeRoomCode(decodeURIComponent(value));
  } catch {
    return normalizeRoomCode(value);
  }
}
