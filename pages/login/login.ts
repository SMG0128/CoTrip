// pages/login/login.ts
// 登录页：调用 AuthService 完成微信登录。
// 认证模式由 config/auth.ts 的 mode 决定：mock 或 real。
// real 模式下后端不可用会明确失败并提示，绝不产生伪造登录态。

import { authService } from '../../services/index';
import { resolveLoginContinuation } from '../../utils/join-flow';
import {
  clearPendingJoinRoomCode,
  getPendingJoinRoomCode,
} from '../../utils/pending-join';

Page({
  data: {
    loading: false,
  },

  onLogin() {
    if (this.data.loading) return;
    this.setData({ loading: true });

    authService
      .login()
      .then((session) => {
        const app = getApp<IAppOption>();
        app.globalData.currentUser = session.user;
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
