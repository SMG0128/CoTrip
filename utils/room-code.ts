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

/**
 * 从任意文本（如分享文案、剪贴板内容）中提取房间码。
 * 优先整串匹配；否则在文本内滑动窗口查找第一个合法 7 位码。
 * 找不到返回空字符串，调用方自行决定是否提示。
 */
export function extractRoomCodeFromText(text: string | undefined | null): string {
  const source = normalizeRoomCode(text);
  if (!source) return '';
  if (isValidRoomCode(source)) return source;
  for (let i = 0; i + ROOM_CODE_LENGTH <= source.length; i++) {
    const candidate = source.slice(i, i + ROOM_CODE_LENGTH);
    if (isValidRoomCode(candidate)) return candidate;
  }
  return '';
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
