// tests/timeline-rows.test.ts
// 时间轴渲染顺序单元测试：验证路线段严格交错在相邻活动之间，
// 绝不挂在目的地下方，也不出现在首活动上方 / 末活动下方。

import { buildTimelineRows, TimelineRow } from '../utils/timeline-rows';
import { PlanEvent } from '../types/event';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

function event(id: string, route?: PlanEvent['route']): PlanEvent {
  return {
    id,
    type: 'OTHER',
    title: id,
    time: { start: '2026-09-10T10:00:00+08:00', timezone: 'Asia/Shanghai' },
    ...(route ? { route } : {}),
  };
}

/** 把行序列转成可读序列：活动显示 id，路线显示文案 */
function toSequence(rows: TimelineRow[]): string[] {
  return rows.map((row) => (row.kind === 'event' ? `A:${row.id}` : `R:${row.routeText}`));
}

function routeTexts(rows: TimelineRow[]): string[] {
  return rows.filter((row) => row.kind === 'route').map((row) => (row as { routeText: string }).routeText);
}

// ---- 1. A/B/C + A->B 地铁 50 分钟 + B->C 步行 9 分钟 → 严格交错 ----
{
  const rows = buildTimelineRows([
    event('event_a'),
    event('event_b', { fromEventId: 'event_a', durationMinutes: 50, mode: 'transit', provider: 'tencent' }),
    event('event_c', { fromEventId: 'event_b', durationMinutes: 9, mode: 'walking', provider: 'tencent' }),
  ]);
  const seq = toSequence(rows);
  assert(
    JSON.stringify(seq) ===
      JSON.stringify(['A:event_a', 'R:地铁 50 分钟', 'A:event_b', 'R:步行 9 分钟', 'A:event_c']),
    `渲染顺序必须是 A / 地铁50 / B / 步行9 / C，实际 ${JSON.stringify(seq)}`,
  );

  // 关键验证：路线不会出现在对应目的地（B/C）下方
  const aIdx = seq.indexOf('A:event_a');
  const bIdx = seq.indexOf('A:event_b');
  const cIdx = seq.indexOf('A:event_c');
  assert(seq[aIdx + 1] === 'R:地铁 50 分钟', '「地铁 50 分钟」必须在 B 之前（A 与 B 之间），不得出现在 B 下方');
  assert(seq[bIdx + 1] === 'R:步行 9 分钟', '「步行 9 分钟」必须在 C 之前（B 与 C 之间），不得出现在 C 下方');
  assert(seq[cIdx + 1] === undefined, '最后一项活动 C 下方绝不能出现 route');
  assert(seq[0] === 'A:event_a', '第一项活动 A 上方绝不能出现 route');
}

// ---- 2. 只有 1 个 Activity → 不显示任何 route ----
{
  const rows = buildTimelineRows([event('only')]);
  assert(rows.length === 1, `单个活动应只有 1 行，实际 ${rows.length}`);
  assert(routeTexts(rows).length === 0, '单个活动不显示任何 route');
  assert(rows[0].kind === 'event' && rows[0].isLast === true, '单个活动即末项活动');
}

// ---- 3. 2 个 Activity → 中间最多显示 1 个 route ----
{
  const rows = buildTimelineRows([
    event('p1'),
    event('p2', { fromEventId: 'p1', durationMinutes: 35, mode: 'driving', provider: 'tencent' }),
  ]);
  assert(
    JSON.stringify(toSequence(rows)) === JSON.stringify(['A:p1', 'R:打车 35 分钟', 'A:p2']),
    `2 个活动中间应只有 1 个 route，实际 ${JSON.stringify(toSequence(rows))}`,
  );
}

// ---- 4. 某一段没有 route 数据 → 不伪造、不占位，后续活动正常渲染 ----
{
  const rows = buildTimelineRows([
    event('a'),
    event('b'), // a->b 无 route
    event('c', { fromEventId: 'b', durationMinutes: 9, mode: 'walking', provider: 'tencent' }),
  ]);
  const seq = toSequence(rows);
  assert(
    JSON.stringify(seq) === JSON.stringify(['A:a', 'A:b', 'R:步行 9 分钟', 'A:c']),
    `缺失段不应伪造/占位，实际 ${JSON.stringify(seq)}`,
  );
}

// ---- 5. fromEventId 不匹配 → 不消费该 route（防止错误段挂靠） ----
{
  const rows = buildTimelineRows([
    event('a'),
    event('b', { fromEventId: 'other', durationMinutes: 50, mode: 'transit', provider: 'tencent' }),
  ]);
  assert(routeTexts(rows).length === 0, `fromEventId 不匹配时不得消费该段，实际 ${JSON.stringify(toSequence(rows))}`);
}

// ---- 6. 首活动自带 route → 必须忽略（首活动上方绝不能出现 route） ----
{
  const rows = buildTimelineRows([
    event('first', { fromEventId: 'ghost', durationMinutes: 10, mode: 'walking', provider: 'tencent' }),
    event('second'),
  ]);
  const seq = toSequence(rows);
  assert(seq[0] === 'A:first' && seq.length === 2, '首活动自带的 route 必须被忽略，不得显示在其上方');
}

console.log('✓ timeline-rows: 路线段交错渲染顺序全部通过');
