// tests/constraint-parser.test.ts
// 约束解析器单元测试（Node 环境，不依赖微信运行时）

import { parseComment, defaultParseContext } from '../core/constraint-parser';
import { Comment } from '../types/comment';

function makeComment(rawText: string, userId = 'user_A'): Comment {
  return {
    id: `comment_${Math.random().toString(36).slice(2)}`,
    tripId: 'trip_test',
    userId,
    rawText,
    createdAt: '2026-08-22T08:00:00+08:00',
    aiStatus: 'processing',
  };
}

const ctx = defaultParseContext('trip_test', '2026-08-22');

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

// ---- 1. AVAILABILITY ----
{
  const c = parseComment(makeComment('我11点半才有空'), ctx);
  assert(c.length === 1, '11点半才有空 应解析出 1 条约束');
  assert(c[0].type === 'AVAILABILITY', '类型应为 AVAILABILITY');
  assert(c[0].priority === 'HARD', '应为 HARD');
  assert(c[0].value.availableAfter === '2026-08-22T11:30:00+08:00', `availableAfter 应为 11:30，实际 ${c[0].value.availableAfter}`);
}

{
  const c = parseComment(makeComment('我下午五点前得走'), ctx);
  assert(c.length === 1, '下午五点前得走 应解析出 1 条约束');
  assert(c[0].type === 'AVAILABILITY', '类型应为 AVAILABILITY');
  assert(c[0].value.availableUntil === '2026-08-22T17:00:00+08:00', `availableUntil 应为 17:00，实际 ${c[0].value.availableUntil}`);
}

// ---- 2. LOCATION ----
{
  const c = parseComment(makeComment('羽毛球必须在天河'), ctx);
  const loc = c.find((x) => x.type === 'LOCATION');
  assert(!!loc, '应解析出 LOCATION 约束');
  assert(loc!.priority === 'HARD', '必须 应为 HARD');
  assert(loc!.scope === 'SPORT', '羽毛球 作用范围应为 SPORT');
  assert(loc!.value.district === '天河区', `district 应为 天河区，实际 ${loc!.value.district}`);
}

{
  const c = parseComment(makeComment('最好在越秀吃'), ctx);
  const loc = c.find((x) => x.type === 'LOCATION');
  assert(!!loc, '应解析出 LOCATION 约束');
  assert(loc!.priority === 'SOFT', '最好 应为 SOFT');
  assert(loc!.scope === 'DINING', '吃 作用范围应为 DINING');
}

// ---- 3. BUDGET ----
{
  const c = parseComment(makeComment('人均不要超过80'), ctx);
  const b = c.find((x) => x.type === 'BUDGET');
  assert(!!b, '应解析出 BUDGET 约束');
  assert(b!.priority === 'HARD', '不要超过 应为 HARD');
  assert(b!.value.max === 80, `max 应为 80，实际 ${b!.value.max}`);
  assert(b!.value.unit === 'PER_PERSON', '人均 单位应为 PER_PERSON');
}

{
  const c = parseComment(makeComment('最好人均80以内'), ctx);
  const b = c.find((x) => x.type === 'BUDGET');
  assert(!!b, '应解析出 BUDGET 约束');
  assert(b!.priority === 'SOFT', '最好 应为 SOFT');
}

{
  // 同时含"最好"与"不要超过"时，语气词优先 → SOFT（V0.3 验收要求）
  const c = parseComment(makeComment('人均最好不要超过80'), ctx);
  const b = c.find((x) => x.type === 'BUDGET');
  assert(!!b, '应解析出 BUDGET 约束');
  assert(b!.priority === 'SOFT', '最好 应覆盖 不要超过，应为 SOFT');
  assert(b!.value.max === 80, `max 应为 80，实际 ${b!.value.max}`);
  assert(b!.value.unit === 'PER_PERSON', '人均 单位应为 PER_PERSON');
}

{
  const c = parseComment(makeComment('最近没钱，便宜点'), ctx);
  const b = c.find((x) => x.type === 'BUDGET');
  assert(!!b, '应解析出 BUDGET 约束');
  assert(b!.priority === 'SOFT', '应为 SOFT');
  assert(b!.value.preference === 'LOW_COST', 'preference 应为 LOW_COST');
}

// ---- 4. PREFERENCE ----
{
  const c = parseComment(makeComment('想吃越南菜'), ctx);
  const p = c.find((x) => x.type === 'PREFERENCE' && x.value.keyword === 'VIETNAMESE');
  assert(!!p, '应解析出越南菜偏好');
  assert(p!.scope === 'DINING', '越南菜 作用范围应为 DINING');
}

{
  const c = parseComment(makeComment('最好坐地铁'), ctx);
  const p = c.find((x) => x.type === 'PREFERENCE' && x.value.keyword === 'METRO');
  assert(!!p, '应解析出地铁偏好');
  assert(p!.priority === 'SOFT', '最好 应为 SOFT');
}

{
  const c = parseComment(makeComment('不想走太远'), ctx);
  const p = c.find((x) => x.type === 'PREFERENCE' && x.value.keyword === 'NEARBY');
  assert(!!p, '应解析出 NEARBY 偏好');
}

// ---- 5. 可追溯性 ----
{
  const comment = makeComment('人均不要超过80');
  const c = parseComment(comment, ctx);
  assert(c[0].sourceCommentId === comment.id, 'sourceCommentId 应指向来源评论');
  assert(c[0].ownerId === comment.userId, 'ownerId 应指向评论作者');
  assert(c[0].tripId === 'trip_test', 'tripId 应正确');
}

// ---- 6. 无法解析 ----
{
  const c = parseComment(makeComment('今天天气不错'), ctx);
  assert(c.length === 0, '无关文本不应解析出约束');
}

console.log('✅ constraint-parser.test.ts 全部通过');