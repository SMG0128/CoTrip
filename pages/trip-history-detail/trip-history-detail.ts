// pages/trip-history-detail/trip-history-detail.ts
// 历史详情页：封板版本，只读，复用 trip-detail 的展示组件。

import { mockHistoryTrip } from '../../mock/mock-trip';
import { mockComments } from '../../mock/mock-comments';
import { mockRestaurants } from '../../mock/mock-restaurants';
import { mockPersonalRoute, mockRouteSegments } from '../../mock/mock-routes';
import { Comment } from '../../types/comment';
import { Trip } from '../../types/trip';

Page({
  data: {
    trip: mockHistoryTrip as Trip,
    comments: mockComments as Comment[],
    restaurants: mockRestaurants,
    route: mockPersonalRoute,
    routeSegments: mockRouteSegments,
    completedText: '',
    participantCount: 0,
  },

  onLoad() {
    const completedAt = mockHistoryTrip.completedAt ?? '';
    this.setData({
      completedText: completedAt ? completedAt.slice(0, 16).replace('T', ' ') : '',
      participantCount: mockHistoryTrip.participantIds.length,
    });
  },

  onPlaceTap(e: WechatMiniprogram.CustomEvent) {
    const location = e.detail.location;
    if (!location) return;
    wx.navigateTo({
      url: `/pages/place-detail/place-detail?locationId=${location.id}`,
    });
  },
});