// server/src/types/user.ts
// 用户领域模型。wechatOpenId 仅存在于服务端，绝不暴露给小程序。

/** 服务端完整用户（含微信身份，仅后端可见） */
export interface User {
  /** CoTrip 内部稳定用户 ID */
  id: string;
  /** 微信 openid，仅服务端持有 */
  wechatOpenId: string;
  nickname: string;
  avatarUrl: string;
  createdAt: number;
  updatedAt: number;
}

/** 小程序可见的公开用户信息（不含 openid / session_key） */
export interface PublicUser {
  id: string;
  nickname: string;
  avatarUrl: string;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    nickname: user.nickname,
    avatarUrl: user.avatarUrl,
  };
}