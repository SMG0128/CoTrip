// pages/home/home.ts
// 首页：展示进行中行程或推荐模式。

import { Trip } from '../../types/trip';
import { tripService } from '../../services/index';
import { hydrateTripWithCurrentUser } from '../../utils/current-user';
import { normalizeRoomCode } from '../../utils/room-code';
import { mergeHomeTrips } from '../../utils/demo-trip';

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

    // 真实行程列表 + 唯一示例行程合并展示；真实接口失败时保留错误提示，
    // 示例行程仍独立可见，但绝不掩盖错误、绝不充当 fallback 数据源。
    const renderTrips = (trips: Trip[]) => {
      const activeTrips = mergeHomeTrips(trips).map((trip) =>
        hydrateTripWithCurrentUser(trip, currentUser)
      );
      this.setData({ activeTrips, hasActiveTrips: activeTrips.length > 0 });
    };

    tripService
      .listActiveTrips()
      .then(renderTrips)
      .catch(() => {
        renderTrips([]);
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

  /** 房间码输入统一走共享归一化边界；不自动生成房间码。 */
  onRoomCodeInput(e: WechatMiniprogram.Input) {
    const normalized = normalizeRoomCode(e.detail.value);
    this.setData({ roomCodeInput: normalized });
  },

  /** 手动加入：仅导航到 Join Landing，绝不伪造加入成功。 */
  onJoinByRoomCode() {
    const code = normalizeRoomCode(this.data.roomCodeInput);
    if (!code) {
      wx.showToast({ title: '请输入房间号', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/pages/join-trip/join-trip?roomCode=${encodeURIComponent(code)}`,
    });
  },
});
