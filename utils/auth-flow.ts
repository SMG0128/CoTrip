// utils/auth-flow.ts
// 启动认证状态机：AUTH_LOADING → UNAUTHENTICATED / PROFILE_REQUIRED / AUTHENTICATED。
// 纯函数、不依赖 wx 运行时，便于 Node 测试。判断只依据真实 session 数据，绝无 Mock fallback。

export type AuthPhase = 'AUTH_LOADING' | 'UNAUTHENTICATED' | 'PROFILE_REQUIRED' | 'AUTHENTICATED';

export const ROUTE_LOGIN = '/pages/login/login';
export const ROUTE_HOME = '/pages/home/home';
export const ROUTE_PROFILE_SETUP = '/pages/profile-setup/profile-setup';

/** 会话最小结构（LoginResult 的结构子集，便于纯函数测试）。
 * 允许携带 nickname 等真实用户字段，但阶段判定只依赖 profileCompleted。 */
export interface AuthSessionLike {
  user: {
    profileCompleted?: boolean;
    nickname?: string;
  };
}

/**
 * 由会话解析认证阶段：
 * - null/undefined → UNAUTHENTICATED
 * - profileCompleted 非 true → PROFILE_REQUIRED
 * - 否则 → AUTHENTICATED
 */
export function resolveAuthPhase(session: AuthSessionLike | null | undefined): AuthPhase {
  if (!session) return 'UNAUTHENTICATED';
  if (session.user.profileCompleted !== true) return 'PROFILE_REQUIRED';
  return 'AUTHENTICATED';
}

export type EntryAction =
  | { kind: 'STAY_LOGIN' } // 未登录：留在登录页展示「微信登录」按钮
  | { kind: 'GO_HOME' } // 有效会话且资料完整：直接首页（session resume，非假登录）
  | { kind: 'GO_PROFILE_SETUP' }; // 有会话但资料未完成：进入完善资料页

/** 冷启动入口动作（登录页 onLoad 使用） */
export function resolveEntryAction(session: AuthSessionLike | null | undefined): EntryAction {
  switch (resolveAuthPhase(session)) {
    case 'PROFILE_REQUIRED':
      return { kind: 'GO_PROFILE_SETUP' };
    case 'AUTHENTICATED':
      return { kind: 'GO_HOME' };
    default:
      return { kind: 'STAY_LOGIN' };
  }
}

/** 昵称长度上限（与服务端 VALIDATION_ERROR 阈值一致） */
const NICKNAME_MAX_LENGTH = 30;

export type NicknameValidation = { ok: true; value: string } | { ok: false; reason: string };

/**
 * 昵称校验：必填、trim、禁止纯空格、最长 30 字符。
 * 校验基于 trim 后的值，通过时返回 trim 后的 value 供提交使用。
 */
export function validateNicknameInput(raw: string): NicknameValidation {
  const value = raw.trim();
  if (!value) return { ok: false, reason: '请输入昵称' };
  if (value.length > NICKNAME_MAX_LENGTH) {
    return { ok: false, reason: '昵称不能超过 30 个字符' };
  }
  return { ok: true, value };
}
