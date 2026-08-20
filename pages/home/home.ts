// pages/home/home.ts
// 首页：展示进行中行程或推荐模式。

import { Trip } from '../../types/trip';
import { tripService } from '../../services/index';
import { hydrateTripWithCurrentUser } from '../../utils/current-user';

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
    const currentUser = app.globalData.currentUser;
    this.setData({ user: currentUser });

    tripService
      .listActiveTrips()
      .then((trips) => {
        const activeTrip = trips[0]
          ? hydrateTripWithCurrentUser(trips[0], currentUser)
          : null;
        this.setData({ activeTrip, hasActiveTrip: activeTrip !== null });
      })
      .catch(() => {
        this.setData({ activeTrip: null, hasActiveTrip: false });
        wx.showToast({ title: '行程加载失败，请稍后重试', icon: 'none' });
      });
  },

  onCreateTrip() {
    wx.navigateTo({ url: '/pages/trip-create/trip-create' });
  },

  onHistory() {
    wx.navigateTo({ url: '/pages/trip-history/trip-history' });
  },

  onEnterTrip() {
    const activeTrip = this.data.activeTrip;
    if (!activeTrip) return;
    wx.navigateTo({
      url: `/pages/trip-detail/trip-detail?tripId=${encodeURIComponent(activeTrip.id)}`,
    });
  },

  onProfile() {
    wx.switchTab({ url: '/pages/profile/profile' });
  },
});
