// tests/event-date-grouping.test.ts
// 事件日期分组单元测试：验证日期头只按活动 local date 生成，绝不使用当前系统日期。

import {
  resolveEventLocalDate,
  formatMonthDay,
  resolveWeekdayLabel,
  buildEventDateHeaders,
} from '../utils/event-date-grouping';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

// ---- 1. event datetime 2026-09-10 10:00 → 分组为 9月10日 ----
{
  const date = resolveEventLocalDate('2026-09-10T10:00:00+08:00');
  assert(date === '2026-09-10', `local date 应为 2026-09-10，实际 ${date}`);
  assert(formatMonthDay(date) === '9月10日', `应为 9月10日，实际 ${formatMonthDay(date)}`);
}

// ---- 1b. 2026-09-10 是周四 ----
{
  const label = resolveWeekdayLabel('2026-09-10');
  assert(label === '周四', `2026-09-10 应为周四，实际 ${label}`);
}

// ---- 2. 同一天 3 个 event → 日期只显示一次 ----
{
  const headers = buildEventDateHeaders([
    { time: { start: '2026-09-10T10:00:00+08:00' } },
    { time: { start: '2026-09-10T13:00:00+08:00' } },
    { time: { start: '2026-09-10T18:30:00+08:00' } },
  ]);
  assert(headers.length === 3, '事件数量不变');
  assert(headers[0] === '9月10日 · 周四', `第一个事件应显示日期头，实际 ${headers[0]}`);
  assert(headers[1] === '', '同一天第二个事件不应重复日期头');
  assert(headers[2] === '', '同一天第三个事件不应重复日期头');
}

// ---- 3. 跨天 events → 第二天出现新 date header ----
{
  const headers = buildEventDateHeaders([
    { time: { start: '2026-09-10T10:00:00+08:00' } },
    { time: { start: '2026-09-11T09:30:00+08:00' } },
    { time: { start: '2026-09-11T14:00:00+08:00' } },
  ]);
  assert(headers[0] === '9月10日 · 周四', `9月10日应显示，实际 ${headers[0]}`);
  assert(headers[1] === '9月11日 · 周五', `跨天出现新日期头，实际 ${headers[1]}`);
  assert(headers[2] === '', '9月11日第二个事件不重复');
}

// ---- 3b. 跨月边界 ----
{
  const headers = buildEventDateHeaders([
    { time: { start: '2026-09-30T10:00:00+08:00' } },
    { time: { start: '2026-10-01T10:00:00+08:00' } },
  ]);
  assert(headers[0] === '9月30日 · 周三', `实际 ${headers[0]}`);
  assert(headers[1] === '10月1日 · 周四', `跨月新日期头，实际 ${headers[1]}`);
}

// ---- 4. 无日期事件不生成 header，也不污染后续分组 ----
{
  const headers = buildEventDateHeaders([
    { time: {} },
    { time: { start: '2026-09-10T10:00:00+08:00' } },
    { time: { start: '2026-09-10T13:00:00+08:00' } },
  ]);
  assert(headers[0] === '', '无日期不显示');
  assert(headers[1] === '9月10日 · 周四', `实际 ${headers[1]}`);
  assert(headers[2] === '', '同天不重复');
}

// ---- 5. 非法日期输入安全返回 ----
{
  assert(resolveEventLocalDate(undefined) === '', 'undefined 返回空串');
  assert(resolveEventLocalDate('not-a-date') === '', '非法字符串返回空串');
  assert(formatMonthDay('garbage') === '', '非法日期返回空串');
}

console.log('✓ event-date-grouping: 日期分组全部通过');
