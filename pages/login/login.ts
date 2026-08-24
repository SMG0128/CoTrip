// pages/login/login.ts
// 登录页：冷启动先等待全局会话恢复结果（globalData.authReady），按认证状态机路由：
// - 有效会话且资料完整 → 直接进入首页（session resume，不重复登录）
// - 有会话但资料未完成 → 进入完善资料页
// - 未登录 → 停留在登录页，点击「微信登录」调用 AuthService 完成真实登录。
// 认证一律真实后端（wx.login → CoTrip Backend）；失败明确提示，绝不产生伪造登录态。

import { authService } from '../../services/index';
import type { LoginResult } from '../../services/auth-service';
import {
  ROUTE_HOME,
  ROUTE_PROFILE_SETUP,
  resolveAuthPhase,
  resolveEntryAction,
} from '../../utils/auth-flow';
import type { AuthPhase } from '../../utils/auth-flow';
import { resolveLoginContinuation } from '../../utils/join-flow';
import {
  clearPendingJoinRoomCode,
  getPendingJoinRoomCode,
} from '../../utils/pending-join';

Page({
  data: {
    /** AUTH_LOADING:启动恢复中，隐藏/禁用登录按钮避免误触；UNAUTHENTICATED:可点击 */
    phase: 'AUTH_LOADING' as AuthPhase,
    loading: false,
  },

  onLoad() {
    this.bootstrapSession();
  },

  /** 冷启动：等待启动期会话恢复结果并决定入口动作 */
  async bootstrapSession(): Promise<void> {
    const app = getApp<IAppOption>();
    let session: LoginResult | null = null;
    try {
      // authReady 内部已兜底为 null，这里再防御一次异常路径
      session = app.globalData.authReady ? await app.globalData.authReady : null;
    } catch {
      session = null;
    }
    // 同步全局当前用户；恢复失败视为未登录
    app.globalData.currentUser = session?.user ?? null;

    const entry = resolveEntryAction(session);
    if (entry.kind === 'GO_HOME') {
      // 老用户 session resume 直达首页，不重复登录
      wx.switchTab({ url: ROUTE_HOME });
      return;
    }
    if (entry.kind === 'GO_PROFILE_SETUP') {
      wx.redirectTo({ url: ROUTE_PROFILE_SETUP });
      return;
    }
    this.setData({ phase: 'UNAUTHENTICATED' });
  },

  onLogin() {
    if (this.data.loading || this.data.phase !== 'UNAUTHENTICATED') return;
    this.setData({ loading: true });

    authService
      .login()
      .then((session) => {
        const app = getApp<IAppOption>();
        app.globalData.currentUser = session.user;
        if (resolveAuthPhase(session) === 'PROFILE_REQUIRED') {
          // 首次用户：先进完善资料页；pending Join 已持久化，保存资料后自动续接。
          wx.redirectTo({ url: ROUTE_PROFILE_SETUP });
          return;
        }
        const pendingRoomCode = getPendingJoinRoomCode();
        const continuation = resolveLoginContinuation(pendingRoomCode);
        if (continuation.kind === 'join') {
          // 登录只恢复邀请落地页；仍需用户再次明确点击“加入行程”。
          wx.redirectTo({ url: continuation.url });
          return;
        }
        // 无效的冷启动残留不应持续影响后续普通登录。
        if (pendingRoomCode) clearPendingJoinRoomCode();
        wx.switchTab({ url: continuation.url });
      })
      .catch((err: Error) => {
        // 失败绝不导航、绝不 fallback，只提示用户重试。
        wx.showToast({
          title: err.message || '登录失败，请重试',
          icon: 'none',
        });
      })
      .finally(() => {
        this.setData({ loading: false });
      });
  },
});
