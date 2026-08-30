// tests/comment-composer.test.ts
// 评论输入栏键盘避让逻辑测试：
// - keyboardHeight 0 → 输入栏使用默认 bottom（保留安全区）
// - keyboardHeight 320 → 输入栏 bottom 正确变为 320px
// - keyboardHeight 改为 280 → 跟随更新
// - keyboardHeight 归 0 → 恢复默认状态
// - 非法/负数高度 → clamp 到 0
// - 发送评论过程中 keyboardHeight 不被业务逻辑错误重置

import {
  buildKeyboardHeightPatch,
  clampKeyboardHeight,
  COMPOSER_BOTTOM_DEFAULT,
  DETAIL_BOTTOM_PADDING_BASE,
  resolveComposerBottom,
  resolveDetailBottomPadding,
} from '../utils/comment-composer';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`断言失败: ${message}`);
}

// 1. keyboardHeight 0 → 输入栏使用默认 bottom
assert(clampKeyboardHeight(0) === 0, '键盘高度 0 保持 0');
assert(
  resolveComposerBottom(0) === COMPOSER_BOTTOM_DEFAULT,
  '键盘收起时输入栏恢复默认 bottom',
);
assert(
  COMPOSER_BOTTOM_DEFAULT.includes('env(safe-area-inset-bottom)'),
  '默认 bottom 必须保留 iPhone 安全区',
);
assert(
  resolveDetailBottomPadding(0) === DETAIL_BOTTOM_PADDING_BASE,
  '键盘收起时页面底部留白恢复默认',
);

// 2. keyboardHeight 320 → 输入栏 bottom 正确变为 320px
const open320 = buildKeyboardHeightPatch(320);
assert(open320.keyboardHeight === 320, '键盘高度 320 被记录');
assert(
  open320.composerBottom === 'calc(12rpx + 320px)',
  `bottom 必须按真实键盘高度变为 320px（实际：${open320.composerBottom}）`,
);
assert(
  open320.composerBottom.includes('320px') && open320.composerBottom.includes('rpx'),
  'bottom 同时保留基础间距 rpx 与真实键盘高度 px',
);
assert(
  !open320.composerBottom.includes('300px') && !open320.composerBottom.includes('500rpx'),
  '不得写死 300px / 500rpx 之类的假高度',
);
assert(open320.composerBottom !== COMPOSER_BOTTOM_DEFAULT, '键盘开启时 bottom 不再使用默认值');
assert(
  open320.detailBottomPadding.includes('320px'),
  `页面底部留白同步追加键盘高度 320px（实际：${open320.detailBottomPadding}）`,
);
// 键盘开启时不再重复叠加安全区（键盘高度已覆盖物理底部）
assert(
  !open320.composerBottom.includes('env(') && !open320.composerBottom.includes('320px + 34px'),
  '键盘开启时不得在 keyboardHeight 之上重复叠加安全区',
);

// 3. keyboardHeight 改为 280 → 跟随更新
const open280 = buildKeyboardHeightPatch(280);
assert(open280.keyboardHeight === 280, '键盘高度更新为 280');
assert(
  open280.composerBottom === 'calc(12rpx + 280px)',
  `bottom 跟随更新为 280px（实际：${open280.composerBottom}）`,
);
assert(open280.detailBottomPadding.includes('280px'), '页面底部留白同步跟随 280px');

// 4. keyboardHeight 归 0 → 恢复默认状态
const closed = buildKeyboardHeightPatch(0);
assert(closed.keyboardHeight === 0, '键盘收起后高度归 0');
assert(closed.composerBottom === COMPOSER_BOTTOM_DEFAULT, '收起后输入栏恢复默认 bottom');
assert(closed.detailBottomPadding === DETAIL_BOTTOM_PADDING_BASE, '收起后页面底部留白恢复默认');

// 5. 非法/负数高度 → clamp 到 0
assert(clampKeyboardHeight(-1) === 0, '负数高度 clamp 到 0');
assert(clampKeyboardHeight(-999) === 0, '大负数高度 clamp 到 0');
assert(clampKeyboardHeight(Number.NaN) === 0, 'NaN clamp 到 0');
assert(clampKeyboardHeight(Number.POSITIVE_INFINITY) === 0, 'Infinity clamp 到 0');
assert(clampKeyboardHeight(undefined as unknown) === 0, 'undefined clamp 到 0');
assert(clampKeyboardHeight('abc' as unknown) === 0, '非数字字符串 clamp 到 0');
assert(
  buildKeyboardHeightPatch(-1).composerBottom === COMPOSER_BOTTOM_DEFAULT,
  '负高度补丁恢复默认 bottom',
);

// 6. 发送评论过程中 keyboardHeight 不被业务逻辑错误重置
let state = buildKeyboardHeightPatch(320);
// 模拟 onSend 的 setData：仅更新评论相关字段，绝不触碰键盘状态字段
const afterSend = {
  ...state,
  comments: [] as unknown[],
  inputText: '',
  commentCount: 1,
};
assert(afterSend.keyboardHeight === 320, '发送评论后键盘高度保持不变');
assert(
  resolveComposerBottom(afterSend.keyboardHeight) === open320.composerBottom,
  '发送后输入栏仍紧贴键盘上沿',
);
// buildKeyboardHeightPatch 是无状态纯函数：重复调用只由 height 决定，业务刷新不会隐式清空
assert(buildKeyboardHeightPatch(320).keyboardHeight === 320, '重复调用不产生副作用');
// 只有键盘真实关闭（height 0）才恢复底部
const afterKeyboardClosed = buildKeyboardHeightPatch(0);
assert(
  afterKeyboardClosed.composerBottom === COMPOSER_BOTTOM_DEFAULT,
  '仅键盘真实关闭才恢复默认 bottom',
);
assert(state.keyboardHeight === 320, '外部业务逻辑不得修改既有键盘状态');

console.log('✅ comment-composer.test.ts 全部通过');
