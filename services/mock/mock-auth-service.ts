// services/mock/mock-auth-service.ts
// AuthService 的 Mock 实现：用于开发环境或后端未就绪时的降级。
// 不调用 wx.login，返回独立的开发用户（绝不使用业务 Mock 数据中的“阿明”作为当前用户）。

import { AuthService, LoginResult } from '../auth-service';
import { mockDevCurrentUser } from '../../mock/mock-user';

export class MockAuthService implements AuthService {
  async login(): Promise<LoginResult> {
    return { user: mockDevCurrentUser };
  }

  async restoreSession(): Promise<LoginResult | null> {
    return { user: mockDevCurrentUser };
  }

  async logout(): Promise<void> {
    // Mock 无持久化，无需清理
  }
}