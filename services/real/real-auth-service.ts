// services/real/real-auth-service.ts
// AuthService 的真实实现：wx.login + CoTrip Backend。
// 依赖 config/auth.ts 中的 baseUrl。real 模式下后端不可用会明确失败，绝不回退 Mock。

import { AuthService, LoginResult } from '../auth-service';
import { appConfig } from '../../config/auth';
import { Participant } from '../../types/participant';
import { currentUserToParticipant } from '../../utils/current-user';

interface PublicUser {
  id: string;
  nickname: string;
  avatarUrl?: string;
  /** 服务端在登录与资料响应中始终返回该标记 */
  profileCompleted: boolean;
}

interface LoginResponse {
  token: string;
  user: PublicUser;
}

interface ProfileResponse {
  user: PublicUser;
}

interface BackendError {
  error?: { code?: string; message?: string };
}

export class RealAuthService implements AuthService {
  private get baseUrl(): string {
    return appConfig.baseUrl.replace(/\/$/, '');
  }

  async login(): Promise<LoginResult> {
    if (!appConfig.baseUrl) {
      throw new Error('未配置后端地址（config/auth.ts baseUrl），无法进行真实微信登录');
    }

    // 1. 获取微信临时登录凭证 code
    const code = await this.getWxLoginCode();

    // 2. 将 code 发送到后端，换取 token + 公开用户信息
    const { token, user } = await this.requestLogin(code);

    // 3. 持久化登录态
    const participant = this.toParticipant(user);
    this.persist(token, participant);

    return { user: participant, token };
  }

  async restoreSession(): Promise<LoginResult | null> {
    const token = wx.getStorageSync<string>(appConfig.tokenStorageKey);
    const user = wx.getStorageSync<Participant>(appConfig.userStorageKey);
    if (!token || !user) return null;

    // 用 token 拉取最新资料
    try {
      const fresh = await this.requestProfile(token);
      const participant = this.toParticipant(fresh);
      this.persist(token, participant);
      return { user: participant, token };
    } catch (err) {
      // 401：token 失效，清除本地会话
      if (this.isUnauthorized(err)) {
        await this.logout();
        return null;
      }
      // 网络失败：优雅降级，不清除本地缓存，但也不视为有效会话
      return null;
    }
  }

  async updateProfile(patch: { nickname?: string; avatarUrl?: string }): Promise<LoginResult> {
    // 身份完全由已持久化的 Bearer token 决定；无 token 直接视为会话失效
    const token = wx.getStorageSync<string>(appConfig.tokenStorageKey);
    if (!token) {
      throw new Error('登录状态失效，请重新登录');
    }

    try {
      const freshUser = await this.requestUpdateProfile(token, patch);
      // token 不变，仅用服务端返回的最新资料覆盖本地用户缓存
      const participant = this.toParticipant(freshUser);
      this.persist(token, participant);
      return { user: participant, token };
    } catch (err) {
      // 401：token 已失效，先清除本地登录态再明确抛错
      if (this.isUnauthorized(err)) {
        await this.logout();
        throw new Error((err as Error).message || '登录状态失效，请重新登录');
      }
      throw err;
    }
  }

  async logout(): Promise<void> {
    wx.removeStorageSync(appConfig.tokenStorageKey);
    wx.removeStorageSync(appConfig.userStorageKey);
  }

  private toParticipant(user: PublicUser): Participant {
    // 统一走当前用户身份转换边界：真实 ID 保留，nickname/avatarUrl 映射为业务参与者字段
    return currentUserToParticipant(user);
  }

  private getWxLoginCode(): Promise<string> {
    return new Promise((resolve, reject) => {
      wx.login({
        success: (res) => {
          if (res.code) {
            resolve(res.code);
          } else {
            reject(new Error('wx.login 未返回 code'));
          }
        },
        fail: (err) => reject(new Error(`wx.login 失败：${err.errMsg}`)),
      });
    });
  }

  private requestLogin(code: string): Promise<LoginResponse> {
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${this.baseUrl}/auth/login`,
        method: 'POST',
        data: { code },
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300 && res.data) {
            resolve(res.data as LoginResponse);
          } else {
            reject(this.toError(res));
          }
        },
        fail: (err) => reject(new Error(`登录请求失败：${err.errMsg}`)),
      });
    });
  }

  private requestProfile(token: string): Promise<PublicUser> {
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${this.baseUrl}/auth/profile`,
        method: 'GET',
        header: { Authorization: `Bearer ${token}` },
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300 && res.data) {
            resolve((res.data as ProfileResponse).user);
          } else {
            reject(this.toError(res));
          }
        },
        fail: (err) => reject(new Error(`资料请求失败：${err.errMsg}`)),
      });
    });
  }

  private requestUpdateProfile(
    token: string,
    patch: { nickname?: string; avatarUrl?: string }
  ): Promise<PublicUser> {
    // 基础库 wx.request 运行时支持 PATCH，但官方类型联合尚未收录该字面量，
    // 经 string 中转做一次受控断言（不使用 any）。
    const methodPatch: string = 'PATCH';
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${this.baseUrl}/auth/profile`,
        method: methodPatch as WechatMiniprogram.RequestOption['method'],
        header: { Authorization: `Bearer ${token}` },
        // body 只含调用方传入的字段，不额外包一层
        data: patch,
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300 && res.data) {
            resolve((res.data as ProfileResponse).user);
          } else {
            reject(this.toError(res));
          }
        },
        fail: (err) => reject(new Error(`资料更新请求失败：${err.errMsg}`)),
      });
    });
  }

  private toError(res: WechatMiniprogram.RequestSuccessCallbackResult): Error {
    const data = res.data as BackendError | undefined;
    const message = data?.error?.message;
    const err = new Error(message || `请求失败（${res.statusCode}）`);
    (err as Error & { statusCode?: number }).statusCode = res.statusCode;
    return err;
  }

  private isUnauthorized(err: unknown): boolean {
    return (err as { statusCode?: number }).statusCode === 401;
  }

  private persist(token: string, user: Participant): void {
    wx.setStorageSync(appConfig.tokenStorageKey, token);
    wx.setStorageSync(appConfig.userStorageKey, user);
  }
}