/**
 * 评论输入栏的键盘避让纯逻辑。
 *
 * 微信回调（wx.onKeyboardHeightChange / bindkeyboardheightchange）中的 height
 * 单位是 **px**，不是 rpx。本模块把 px 键盘高度换算成输入栏的 CSS bottom 与
 * 页面底部滚动留白，保证输入栏始终紧贴软键盘上沿，且不破坏安全区布局。
 */

/**
 * 键盘高度下限收敛：负值 / NaN / Infinity / 非数字一律视为 0（键盘收起）。
 * @param height 微信回调中的键盘高度（px），非法值按 0 处理
 */
export function clampKeyboardHeight(height: unknown): number {
  const value = typeof height === 'number' ? height : Number(height);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

/** 评论输入栏与页面底部的基础间距（rpx），与既有布局一致 */
export const COMPOSER_BOTTOM_GAP_RPX = 12;

/**
 * 键盘关闭时输入栏的默认 bottom：
 * 间距 + env(safe-area-inset-bottom)，兼容 iPhone Home Indicator。
 */
export const COMPOSER_BOTTOM_DEFAULT = `calc(${COMPOSER_BOTTOM_GAP_RPX}rpx + env(safe-area-inset-bottom))`;

/**
 * 键盘关闭时页面底部的滚动留白（容纳固定输入栏），与既有布局一致。
 */
export const DETAIL_BOTTOM_PADDING_BASE = 'calc(164rpx + env(safe-area-inset-bottom))';

/**
 * 依据真实键盘高度（px）计算评论输入栏的 CSS bottom：
 * - 键盘开启（height > 0）：bottom = 间距 + 键盘高度，输入栏紧贴键盘上沿。
 *   键盘高度从屏幕物理底部起算，本身已覆盖底部安全区，因此不重复叠加 env()。
 * - 键盘关闭（height = 0）：恢复默认（间距 + env(safe-area-inset-bottom)）。
 */
export function resolveComposerBottom(keyboardHeight: number): string {
  const height = clampKeyboardHeight(keyboardHeight);
  if (height <= 0) return COMPOSER_BOTTOM_DEFAULT;
  return `calc(${COMPOSER_BOTTOM_GAP_RPX}rpx + ${height}px)`;
}

/**
 * 键盘开启时页面底部的滚动留白：在原有基础上追加键盘高度（px），
 * 保证评论列表最后一条可滚动到输入栏上方；键盘关闭恢复默认。
 */
export function resolveDetailBottomPadding(keyboardHeight: number): string {
  const height = clampKeyboardHeight(keyboardHeight);
  if (height <= 0) return DETAIL_BOTTOM_PADDING_BASE;
  return `calc(164rpx + env(safe-area-inset-bottom) + ${height}px)`;
}

/** 键盘高度变化时页面需要同步的完整数据补丁 */
export interface KeyboardHeightPatch {
  keyboardHeight: number;
  composerBottom: string;
  detailBottomPadding: string;
}

/**
 * 将微信回调中的键盘高度（px，可能是非法值）转换为可直接 setData 的数据补丁。
 * 纯函数、无任何外部可变状态：业务侧刷新（如发送评论）不会隐式清空键盘高度。
 */
export function buildKeyboardHeightPatch(height: unknown): KeyboardHeightPatch {
  const keyboardHeight = clampKeyboardHeight(height);
  return {
    keyboardHeight,
    composerBottom: resolveComposerBottom(keyboardHeight),
    detailBottomPadding: resolveDetailBottomPadding(keyboardHeight),
  };
}
