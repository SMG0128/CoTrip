// services/mock/mock-auth-service.ts
// AuthService 的 Mock 实现：用于开发环境或后端未就绪时的降级。
// 不调用 wx.login，直接返回固定用户。

import { AuthService, LoginResult } from '../auth-service';
import { mockCurrentUser } from '../../mock/mock-user';

export class MockAuthService implements AuthService {
  async login(): Promise<LoginResult> {
    return { user: mockCurrentUser };
  }

  async restoreSession(): Promise<LoginResult | null> {
    return { user: mockCurrentUser };
  }

  async logout(): Promise<void> {
    // Mock 无持久化，无需清理
  }
}