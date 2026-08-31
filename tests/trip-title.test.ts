// trip-title 测试：创建行程标题规则（用户必填、规范化、长度与后端一致）。

import { resolveTripTitle, TRIP_TITLE_MAX_LENGTH } from '../utils/trip-title';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`断言失败: ${message}`);
}

export async function runTripTitleTests(): Promise<void> {
  // 正常标题：去除首尾空白后通过
  const normal = resolveTripTitle('  顺德周末美食之旅  ');
  assert(normal.ok, '正常标题必须通过');
  assert(normal.title === '顺德周末美食之旅', '标题必须去除首尾空白');

  // 空标题（含纯空白）：拒绝并给出提示
  assert(!resolveTripTitle('').ok, '空标题必须被拒绝');
  const blank = resolveTripTitle('   ');
  assert(!blank.ok, '纯空白标题必须被拒绝');
  assert(blank.error === '请填写行程标题', '空标题必须提示用户填写');

  // 超长标题：与后端 validation（1-100）保持一致
  assert(!resolveTripTitle('x'.repeat(TRIP_TITLE_MAX_LENGTH + 1)).ok, '超过 100 字符的标题必须被拒绝');
  assert(resolveTripTitle('x'.repeat(TRIP_TITLE_MAX_LENGTH)).ok, '恰好 100 字符的标题必须通过');

  console.log('✅ trip-title.test.ts 全部通过');
}
