// services/real/real-auth-service.ts
// AuthService 的真实实现：wx.login + CoTrip Backend。
// 依赖 config/auth.ts 中的 baseUrl。real 模式下后端不可用会明确失败，绝不回退 Mock。

import { AuthService, LoginResult } from '../auth-service';
import { authConfig } from '../../config/auth';
import { Participant } from '../../types/participant';
import { currentUserToParticipant } from '../../utils/current-user';

interface PublicUser {
  id: string;
  nickname: string;
  avatarUrl?: string;
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
    return authConfig.baseUrl.replace(/\/$/, '');
  }

  async login(): Promise<LoginResult> {
    if (!authConfig.baseUrl) {
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
    const token = wx.getStorageSync<string>(authConfig.tokenStorageKey);
    const user = wx.getStorageSync<Participant>(authConfig.userStorageKey);
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

  async logout(): Promise<void> {
    wx.removeStorageSync(authConfig.tokenStorageKey);
    wx.removeStorageSync(authConfig.userStorageKey);
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
    wx.setStorageSync(authConfig.tokenStorageKey, token);
    wx.setStorageSync(authConfig.userStorageKey, user);
  }
}