// trip-temporal-resolution.ts
// 确定性时间解析（Temporal Resolution）。
//
// 核心不变量：LLM 不得把 current time / Date.now() 作为行程活动时间。
// 本模块在 AI 返回行程 snapshot 之后、落库之前，把每个活动时间锚定到行程日期。
//
// 优先级（B 节）：
//   1. 用户明确指定日期 + 时间 → 使用用户指定
//   2. 用户明确指定日期但没时间     → 在该日期选择合理的最早时间
//   3. 用户只指定时间               → 使用 trip startDate 起最早可行日期
//   4. 用户没有日期                 → 从 trip startDate 开始寻找最早可行日期
//   5. 用户没有时间                 → 根据活动类型选择合理时间，禁止用「当前系统时间」填充
//
// 本模块是纯函数：不读取 Date.now()，不依赖系统时钟，保证确定性可测试。

import { TripPlanEvent, TripPlanTimeRange } from '../types/trip-plan';

/** 行程时间锚点：来自 trip.timeRange（创建时用户选择） */
export interface TripTimeAnchor {
  /** 行程开始日期，如 2026-09-10 */
  startDate: string;
  /** 行程时区，如 Asia/Shanghai */
  timezone: string;
  /** 行程开始时间（HH:mm），可选 */
  startTime?: string;
}

/** 活动类型 → 默认开始时间（仅当用户完全没给时间时使用，绝不使用当前时钟） */
const DEFAULT_START_BY_TYPE: Record<string, string> = {
  SPORT: '09:00',
  DINING: '12:00',
  TRANSPORT: '08:00',
  ENTERTAINMENT: '14:00',
  OTHER: '10:00',
};

/** 时区偏移映射（仅支持项目实际使用的时区；缺省 +08:00） */
function offsetForTimezone(timezone: string): string {
  if (timezone === 'Asia/Shanghai') return '+08:00';
  return '+08:00';
}

/** 把日期 + HH:mm 组合为带时区的 ISO-8601 时间戳 */
export function combineDateTime(
  date: string,
  time: string,
  timezone: string,
): string {
  const offset = offsetForTimezone(timezone);
  return `${date}T${time}:00${offset}`;
}

/** 从 ISO-8601 时间戳提取日期部分（YYYY-MM-DD） */
export function extractDate(iso: string): string {
  return iso.slice(0, 10);
}

/** 从 ISO-8601 时间戳提取 HH:mm */
export function extractTime(iso: string): string {
  return iso.slice(11, 16);
}

/** 判断 ISO 时间戳是否落在行程开始日期当天 */
function isOnStartDate(iso: string, anchor: TripTimeAnchor): boolean {
  return extractDate(iso) === anchor.startDate;
}

/**
 * 解析单个活动的时间。
 *
 * 输入是 AI 返回的 time（可能带日期、可能只带时间、可能完全缺失），
 * 输出是锚定到行程日期的确定性时间范围。
 *
 * 规则：
 *   - 若 AI 时间落在行程 startDate 当天 → 保留（用户/模型已指定日期+时间）
 *   - 若 AI 时间落在其他日期 → 重新锚定到 startDate（禁止把行程外日期带进来）
 *   - 若 AI 只给了时间（无日期）→ 使用 startDate + 该时间
 *   - 若 AI 完全没给时间 → 使用 startDate + 活动类型默认时间
 *   - 若行程有 startTime 且活动无明确时间 → 使用 startDate + startTime
 */
export function resolveEventTime(
  aiTime: TripPlanTimeRange | undefined,
  eventType: string,
  anchor: TripTimeAnchor,
): TripPlanTimeRange {
  const timezone = anchor.timezone || 'Asia/Shanghai';

  // 情况 1/2：AI 已给出结构化时间
  if (aiTime && aiTime.start) {
    const aiStart = aiTime.start;
    // 若 AI 时间已落在行程开始日 → 直接采用（用户明确指定日期+时间）
    if (isOnStartDate(aiStart, anchor)) {
      return {
        start: aiStart,
        ...(aiTime.end ? { end: aiTime.end } : {}),
        timezone,
      };
    }
    // AI 时间落在其他日期（例如用了当前系统日期）→ 重新锚定到行程日期，保留其时刻
    const time = extractTime(aiStart);
    const start = combineDateTime(anchor.startDate, time, timezone);
    const end = aiTime.end
      ? combineDateTime(anchor.startDate, extractTime(aiTime.end), timezone)
      : undefined;
    return { start, ...(end ? { end } : {}), timezone };
  }

  // 2/3/4/5：AI 没给时间 → 用行程 startTime 或活动类型默认时间
  const time = anchor.startTime || DEFAULT_START_BY_TYPE[eventType] || '10:00';
  return {
    start: combineDateTime(anchor.startDate, time, timezone),
    timezone,
  };
}

/**
 * 对整份行程计划做时间锚定。
 * 返回新的事件数组（不修改入参）。
 */
export function resolvePlanTimes(
  events: TripPlanEvent[],
  anchor: TripTimeAnchor,
): TripPlanEvent[] {
  return events.map((event) => ({
    ...event,
    time: resolveEventTime(event.time, event.type, anchor),
  }));
}

/**
 * 从 trip.timeRange 构造时间锚点。
 * timeRange 结构：{ start: ISO, end?: ISO, timezone }。
 * 若 timeRange 缺失，则无法锚定（返回 null，调用方决定是否跳过时间修正）。
 */
export function buildTimeAnchor(
  timeRange: { start?: string; end?: string; timezone?: string } | undefined,
): TripTimeAnchor | null {
  if (!timeRange || !timeRange.start) return null;
  return {
    startDate: extractDate(timeRange.start),
    timezone: timeRange.timezone || 'Asia/Shanghai',
    startTime: extractTime(timeRange.start),
  };
}