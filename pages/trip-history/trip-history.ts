// pages/trip-history/trip-history.ts
// 历史行程页：纵向大列表。

import { mockHistoryTrip } from '../../mock/mock-trip';
import { Trip } from '../../types/trip';

Page({
  data: {
    trips: [mockHistoryTrip] as Trip[],
  },

  onTripTap() {
    wx.navigateTo({ url: '/pages/trip-history-detail/trip-history-detail' });
  },
});