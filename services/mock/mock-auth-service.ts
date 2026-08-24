// services/mock/mock-auth-service.ts
// AuthService 的 Mock 实现：用于开发环境或后端未就绪时的降级。
// 不调用 wx.login，返回独立的开发用户（绝不使用业务 Mock 数据中的“阿明”作为当前用户）。

import { AuthService, LoginResult } from '../auth-service';
import { mockDevCurrentUser } from '../../mock/mock-user';

/** 仅用于 local/mock development，让“退出后冷启动”保持未登录。 */
const MOCK_LOGGED_OUT_STORAGE_KEY = 'cotrip_mock_logged_out';

export class MockAuthService implements AuthService {
  async login(): Promise<LoginResult> {
    wx.removeStorageSync(MOCK_LOGGED_OUT_STORAGE_KEY);
    return { user: mockDevCurrentUser };
  }

  async restoreSession(): Promise<LoginResult | null> {
    if (wx.getStorageSync<boolean>(MOCK_LOGGED_OUT_STORAGE_KEY)) return null;
    return { user: mockDevCurrentUser };
  }

  async logout(): Promise<void> {
    wx.setStorageSync(MOCK_LOGGED_OUT_STORAGE_KEY, true);
  }

  /** Mock 实现：直接改写开发用户内存对象，并把资料完善标记置为已完成。 */
  async updateProfile(patch: { nickname?: string; avatarUrl?: string }): Promise<LoginResult> {
    if (patch.nickname !== undefined) mockDevCurrentUser.nickname = patch.nickname.trim();
    if (patch.avatarUrl !== undefined) mockDevCurrentUser.avatarUrl = patch.avatarUrl;
    mockDevCurrentUser.profileCompleted = true;
    return { user: mockDevCurrentUser };
  }
}
