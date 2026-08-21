// pages/home/home.ts
// 首页：展示进行中行程或推荐模式。

import { Trip } from '../../types/trip';
import { tripService } from '../../services/index';
import { hydrateTripWithCurrentUser } from '../../utils/current-user';

Page({
  data: {
    user: null as import('../../types/participant').Participant | null,
    activeTrips: [] as Trip[],
    hasActiveTrips: false,
    roomCodeInput: '',
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

    // 多进行中行程：返回多少展示多少（最新在前，较旧在后）。
    tripService
      .listActiveTrips()
      .then((trips) => {
        const activeTrips = trips.map((trip) => hydrateTripWithCurrentUser(trip, currentUser));
        this.setData({ activeTrips, hasActiveTrips: activeTrips.length > 0 });
      })
      .catch(() => {
        this.setData({ activeTrips: [], hasActiveTrips: false });
        wx.showToast({ title: '行程加载失败，请稍后重试', icon: 'none' });
      });
  },

  onCreateTrip() {
    wx.navigateTo({ url: '/pages/trip-create/trip-create' });
  },

  onHistory() {
    wx.navigateTo({ url: '/pages/trip-history/trip-history' });
  },

  /** 每张 Trip 卡各自导航到自己的详情（依赖 component event detail.trip）。 */
  onEnterTrip(e: WechatMiniprogram.CustomEvent) {
    const trip = e.detail?.trip as Trip | undefined;
    if (!trip?.id) return;
    wx.navigateTo({
      url: `/pages/trip-detail/trip-detail?tripId=${encodeURIComponent(trip.id)}`,
    });
  },

  onProfile() {
    wx.switchTab({ url: '/pages/profile/profile' });
  },

  /** 房间码输入：轻量归一化（trim + 去空格 + uppercase）。不自动生成房间码。 */
  onRoomCodeInput(e: WechatMiniprogram.Input) {
    const normalized = (e.detail.value || '').replace(/\s+/g, '').toUpperCase();
    this.setData({ roomCodeInput: normalized });
  },

  /** 手动加入：仅导航到 Join Landing，绝不伪造加入成功。 */
  onJoinByRoomCode() {
    const code = this.data.roomCodeInput.trim();
    if (!code) {
      wx.showToast({ title: '请输入房间号', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/pages/join-trip/join-trip?roomCode=${encodeURIComponent(code)}`,
    });
  },
});
