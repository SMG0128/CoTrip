// utils/avatar.ts
// 头像展示与选择的纯函数边界。
//
// 规则：
// - 头像绝不参与 profileCompleted 判定（那只由合法昵称决定）。
// - 新默认头像是一张极简线条人物 SVG（assets/icons/avatar/default-avatar.svg），
//   与 UI icon 同风格：单色描边、透明背景。
// - 历史用户的「旧默认头像」（3D boy/girl 占位图）视为 legacy placeholder：
//   仅在展示层回退到新 SVG，不改写真实用户数据。
// - 远程 URL / 数据 URI 一律视为用户真实头像，绝不被误判或覆盖。

/** 新默认头像（极简线条人物 SVG） */
export const DEFAULT_AVATAR_SRC = '/assets/icons/avatar/default-avatar.svg';

/** 历史版本的占位头像资源路径（旧默认头像），展示时统一回退到新默认头像 */
const LEGACY_AVATAR_PLACEHOLDERS = ['/assets/3d/boy.png', '/assets/3d/girl.png'];

/**
 * 是否为「无真实头像」：空值，或旧版占位资源。
 * 远程 URL 与 data URI 一律不算默认头像（保护用户已设置的真实头像）。
 */
export function isDefaultAvatar(avatarUrl: string | undefined | null): boolean {
  const value = (avatarUrl ?? '').trim();
  if (!value) return true;
  if (/^(https?:|data:)/i.test(value)) return false;
  return LEGACY_AVATAR_PLACEHOLDERS.includes(value);
}

/** 展示用解析：空值 / legacy 占位 → 新默认 SVG；真实头像原样返回 */
export function resolveAvatar(avatarUrl: string | undefined | null): string {
  if (isDefaultAvatar(avatarUrl)) return DEFAULT_AVATAR_SRC;
  return (avatarUrl ?? '').trim();
}

/** 「使用微信头像」选择结果的应用结果 */
export interface AvatarChoiceOutcome {
  /** 是否产生了新的预览值（取消/失败时为 false） */
  changed: boolean;
  /** 预览值（changed=false 时即原值） */
  avatarUrl: string;
}

/**
 * 应用一次微信头像选择到当前草稿：
 * - 用户取消 / 平台未返回路径 → 保持原状（changed=false），不报错、不清空；
 * - 选择成功 → 返回临时路径供预览与后续持久化转换。
 */
export function applyChosenAvatar(
  currentDraft: string | undefined | null,
  chosenPath?: string | null
): AvatarChoiceOutcome {
  const current = (currentDraft ?? '').trim();
  const chosen = (chosenPath ?? '').trim();
  if (!chosen) return { changed: false, avatarUrl: current };
  return { changed: true, avatarUrl: chosen };
}
