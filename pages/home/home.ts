// pages/home/home.ts
// 首页：展示进行中行程或推荐模式。

import { mockActiveTrip } from '../../mock/mock-trip';
import { mockCurrentUser } from '../../mock/mock-user';
import { Trip } from '../../types/trip';

Page({
  data: {
    user: mockCurrentUser,
    activeTrip: null as Trip | null,
    hasActiveTrip: false,
  },

  onShow() {
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