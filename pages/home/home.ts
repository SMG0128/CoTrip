// pages/home/home.ts
// 首页：展示进行中行程或推荐模式。

import { mockActiveTrip } from '../../mock/mock-trip';
import { Trip } from '../../types/trip';

Page({
  data: {
    user: null as import('../../types/participant').Participant | null,
    activeTrip: null as Trip | null,
    hasActiveTrip: false,
  },

  onShow() {
    const tabBar = this.getTabBar();
    if (tabBar) {
      tabBar.setData({ selected: 0 });
    }

    // 从全局读取当前登录用户
    const app = getApp<IAppOption>();
    this.setData({ user: app.globalData.currentUser });

    // Mock：直接使用固定进行中行程
    this.setData({
      activeTrip: mockActiveTrip,
      hasActiveTrip: true,
    });
  },

  onCreateTrip() {
    wx.navigateTo({ url: '/pages/trip-create/trip-create' });
  },

  onHistory() {
    wx.navigateTo({ url: '/pages/trip-history/trip-history' });
  },

  onEnterTrip() {
    wx.navigateTo({ url: '/pages/trip-detail/trip-detail' });
  },

  onProfile() {
    wx.switchTab({ url: '/pages/profile/profile' });
  },
});
