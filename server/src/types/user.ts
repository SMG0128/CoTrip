// server/src/types/user.ts
// 用户领域模型。wechatOpenId 仅存在于服务端，绝不暴露给小程序。

/** 新账号的默认昵称占位：真实昵称由首次资料完善流程保存 */
export const DEFAULT_USER_NICKNAME = '微信用户';

/** 服务端完整用户（含微信身份，仅后端可见） */
export interface User {
  /** CoTrip 内部稳定用户 ID */
  id: string;
  /** 微信 openid，仅服务端持有 */
  wechatOpenId: string;
  nickname: string;
  avatarUrl: string;
  /**
   * 是否已完成首次资料完善（真实保存过自定义昵称）。
   * 历史数据可能缺失该字段，展示层用 hasCompletedProfile 兜底判断。
   */
  profileCompleted?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 小程序可见的公开用户信息（不含 openid / session_key） */
export interface PublicUser {
  id: string;
  nickname: string;
  avatarUrl: string;
  /** 客户端据此路由到「完善资料」页或直接进入首页 */
  profileCompleted: boolean;
}

/**
 * 昵称是否为「真实资料」：trim 后非空且不是默认占位名。
 * 这是 profileCompleted 的唯一定义来源：用户拥有合法、非空的昵称。
 */
export function isRealNickname(nickname: string): boolean {
  const trimmed = nickname.trim();
  return !!trimmed && trimmed !== DEFAULT_USER_NICKNAME;
}

/**
 * 资料是否已完成：
 * - 显式标记优先；
 * - 历史用户（字段缺失）按「拥有真实昵称」兜底，避免老用户被迫重新填写。
 */
export function hasCompletedProfile(user: Pick<User, 'nickname' | 'profileCompleted'>): boolean {
  if (user.profileCompleted !== undefined) return user.profileCompleted;
  return isRealNickname(user.nickname);
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    nickname: user.nickname,
    avatarUrl: user.avatarUrl,
    profileCompleted: hasCompletedProfile(user),
  };
}
