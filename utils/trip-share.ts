// utils/trip-share.ts
// 行程邀请分享载荷（V0.3 UI Foundation）。
// 纯函数：不依赖 wx 运行时，可直接 Node 测试。
//
// 规则：
// - 有 roomCode → 分享加入 join-trip 页面（roomCode 必须 encodeURIComponent）。
// - 无 roomCode → 安全回退分享首页，绝不伪造 roomCode / 不声称可加入当前 Trip。
// - 禁止从 trip.id / userId / timestamp 自行拼造房间号。

import { isValidRoomCode, normalizeRoomCode } from './room-code';

// 保留既有导入 API，同时确保分享、首页与 Join Landing 使用同一规范化实现。
export { normalizeRoomCode } from './room-code';

/** roomCode 缺失时 UI 展示的占位文案 */
export const ROOM_CODE_PLACEHOLDER = '待生成';

/** roomCode 缺失时安全回退的分享标题（不声称能加入当前 Trip） */
export const SAFE_FALLBACK_SHARE_TITLE = '来 CoTrip 一起规划行程';

export interface TripSharePayload {
  title: string;
  path: string;
  /** 是否存在有效 roomCode（用于 UI/测试判断是否进入加入流程） */
  hasRoomCode: boolean;
}

/** 构造微信 onShareAppMessage 的返回载荷 */
export function buildTripSharePayload(trip: {
  title: string;
  roomCode?: string;
}): TripSharePayload {
  const roomCode = normalizeRoomCode(trip.roomCode);
  if (isValidRoomCode(roomCode)) {
    return {
      title: `一起规划「${trip.title}」`,
      path: `/pages/join-trip/join-trip?roomCode=${encodeURIComponent(roomCode)}`,
      hasRoomCode: true,
    };
  }
  return {
    title: SAFE_FALLBACK_SHARE_TITLE,
    path: '/pages/home/home',
    hasRoomCode: false,
  };
}

/** 房间号展示值：缺失时显示「待生成」 */
export function resolveRoomCodeDisplay(roomCode: string | undefined): string {
  const normalized = normalizeRoomCode(roomCode);
  return isValidRoomCode(normalized) ? normalized : ROOM_CODE_PLACEHOLDER;
}

/** 复制房间号的 toast 文案：不存在有效房间号时明确提示 */
export function roomCopyFeedback(roomCode: string | undefined): string {
  return isValidRoomCode(normalizeRoomCode(roomCode)) ? '房间号已复制' : '房间号尚未生成';
}
