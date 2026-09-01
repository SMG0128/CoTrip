// utils/event-date-grouping.ts
// 事件日期分组：按活动的 local date（Asia/Shanghai +08:00）生成低干扰层级日期头。
//
// 规则：
//   - 日期只来自最终 trip event 的 datetime（time.start），绝不使用当前系统日期。
//   - 同一天内的后续事件不重复显示日期头；跨天时下一个日期头出现。
//   - 星期由纯日期计算（Date.UTC）推导，与时区、当前时间无关。
//
// 纯函数，便于确定性测试。

export type EventTimeLike = { time?: { start?: string } };

/** 星期中文标签（index = Date.getUTCDay()） */
const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 从 ISO 时间字符串解析本地日期（Asia/Shanghai +08:00），返回 'YYYY-MM-DD' 或空串 */
export function resolveEventLocalDate(startIso: string | undefined): string {
  if (!startIso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(startIso);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

/** 把 'YYYY-MM-DD' 渲染为「9月10日」；非法输入返回空串 */
export function formatMonthDay(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return '';
  return `${Number(m[2])}月${Number(m[3])}日`;
}

/** 计算某日期的星期标签（纯日期计算，不依赖当前系统时间） */
export function resolveWeekdayLabel(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return '';
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return WEEKDAY_LABELS[weekday];
}

/**
 * 生成与事件数组平行的日期头数组：
 *   - 每个日期变化的第一个事件返回「9月10日 · 周四」
 *   - 同一天后续事件返回空串（不重复显示）
 *   - 无有效日期的返回空串
 */
export function buildEventDateHeaders(events: EventTimeLike[]): string[] {
  let prevDate = '';
  return events.map((event) => {
    const date = resolveEventLocalDate(event.time?.start);
    if (!date) return '';
    if (date === prevDate) return '';
    prevDate = date;
    return `${formatMonthDay(date)} · ${resolveWeekdayLabel(date)}`;
  });
}
