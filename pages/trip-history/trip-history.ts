// pages/trip-history/trip-history.ts
// 历史行程页：纵向大列表。

import { Trip } from '../../types/trip';
import { tripService } from '../../services/index';

Page({
  data: {
    trips: [] as Trip[],
  },

  onShow() {
    tripService
      .listHistoryTrips()
      .then((trips) => this.setData({ trips }))
      .catch(() => {
        this.setData({ trips: [] });
        wx.showToast({ title: '历史行程加载失败', icon: 'none' });
      });
  },

  onTripTap(e: WechatMiniprogram.TouchEvent) {
    const tripId = e.currentTarget.dataset.tripId as string | undefined;
    if (!tripId) return;
    wx.navigateTo({
      url: `/pages/trip-history-detail/trip-history-detail?tripId=${encodeURIComponent(tripId)}`,
    });
  },
});
