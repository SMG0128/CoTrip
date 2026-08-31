// utils/trip-title.ts
// 创建行程的标题规则：用户必填、去除首尾空白、长度与后端 validation 一致（1-100 字符）。
// 业务规则独立成纯函数，页面 handler 只做调用。

export const TRIP_TITLE_MAX_LENGTH = 100;

export interface TripTitleResolution {
  ok: boolean;
  /** 规范化后的标题（仅 ok 时有意义） */
  title: string;
  /** 不通过时的用户提示文案 */
  error?: string;
}

export function resolveTripTitle(rawTitle: string): TripTitleResolution {
  const title = (typeof rawTitle === 'string' ? rawTitle : '').trim();
  if (!title) {
    return { ok: false, title: '', error: '请填写行程标题' };
  }
  if (title.length > TRIP_TITLE_MAX_LENGTH) {
    return { ok: false, title: '', error: `行程标题不能超过 ${TRIP_TITLE_MAX_LENGTH} 个字符` };
  }
  return { ok: true, title };
}
