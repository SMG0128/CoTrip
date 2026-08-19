// types/time.ts
// 时间必须是结构化 ISO 8601 数据，禁止使用 "下午两点" 这类纯文本。

export interface TimeRange {
  /** ISO 8601 起始时间，如 2026-08-22T14:00:00+08:00 */
  start: string;
  /** ISO 8601 结束时间，可选 */
  end?: string;
  /** IANA 时区，如 Asia/Shanghai */
  timezone: string;
}