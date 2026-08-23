// V0.3 Room Identity：服务器生成人读友好的房间号。
//
// 规则：
// - 仅使用不易混淆字符（排除 0/O、1/I/L），全大写
// - 长度固定 7 位
// - 不允许客户端生成；也不允许用 tripId / userId / 时间戳截断

/** 房间号字符集：ABCDEFGHJKMNPQRSTUVWXYZ + 23456789 */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** 房间号长度 */
export const ROOM_CODE_LENGTH = 7;

/** 用户输入统一移除所有空白并转大写，再进行严格字符集校验。 */
export function normalizeRoomCode(code: unknown): string {
  return typeof code === 'string' ? code.replace(/\s+/g, '').toUpperCase() : '';
}

/**
 * 生成一个房间号。
 * @param random 可注入的随机源（测试用，默认 Math.random）
 */
export function generateRoomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    const index = Math.floor(random() * ROOM_CODE_ALPHABET.length);
    code += ROOM_CODE_ALPHABET.charAt(index);
  }
  return code;
}

/** 校验房间号是否为服务器生成的合法格式（长度 + 字符集）。 */
export function isValidRoomCode(code: unknown): code is string {
  if (typeof code !== 'string' || code.length !== ROOM_CODE_LENGTH) {
    return false;
  }
  for (const ch of code) {
    if (!ROOM_CODE_ALPHABET.includes(ch)) {
      return false;
    }
  }
  return true;
}
