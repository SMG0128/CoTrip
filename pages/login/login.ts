// pages/login/login.ts
// 登录页：当前仅 Mock 登录，不接真实 wx.login 后端。

import { mockCurrentUser } from '../../mock/mock-user';

Page({
  data: {
    loading: false,
  },

  onLogin() {
    if (this.data.loading) return;
    this.setData({ loading: true });

    // Mock 登录：设置全局用户后跳转首页
    const app = getApp<IAppOption>();
    app.globalData.currentUser = mockCurrentUser;

    setTimeout(() => {
      wx.switchTab({ url: '/pages/home/home' });
    }, 400);
  },
});