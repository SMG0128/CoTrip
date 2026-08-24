// services/auth-service.ts
// 认证服务接口：负责微信登录、登录态持久化与用户资料获取。
// 真实实现走 wx.login + 后端 code2Session；Mock 实现用于开发/降级。

import { Participant } from '../types/participant';

/** 登录结果 */
export interface LoginResult {
  /** 登录后的用户信息 */
  user: Participant;
  /** 后端下发的自定义登录态 token（真实登录时存在） */
  token?: string;
}

export interface AuthService {
  /**
   * 执行微信登录。
   * 真实实现：wx.login 获取 code → 请求后端换取 openid + token → 拉取用户资料。
   * Mock 实现：直接返回固定用户。
   */
  login(): Promise<LoginResult>;

  /** 从本地缓存恢复登录态；未登录返回 null */
  restoreSession(): Promise<LoginResult | null>;

  /**
   * 更新当前登录用户的资料（PATCH /auth/profile）。
   * 身份完全由已持久化的 Bearer token 决定；失败明确抛错，绝不本地伪造成功。
   */
  updateProfile(patch: { nickname?: string; avatarUrl?: string }): Promise<LoginResult>;

  /** 退出登录，清除本地登录态 */
  logout(): Promise<void>;
}