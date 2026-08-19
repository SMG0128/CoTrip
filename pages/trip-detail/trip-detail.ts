// pages/trip-detail/trip-detail.ts
// 行程详情页：整个产品最核心的页面。

import { mockActiveTrip } from '../../mock/mock-trip';
import { mockComments } from '../../mock/mock-comments';
import { mockRestaurants } from '../../mock/mock-restaurants';
import { mockPersonalRoute, mockRouteSegments } from '../../mock/mock-routes';
import { mockCurrentUser } from '../../mock/mock-user';
import { Comment } from '../../types/comment';
import { Trip } from '../../types/trip';

Page({
  data: {
    trip: mockActiveTrip as Trip,
    comments: mockComments as Comment[],
    restaurants: mockRestaurants,
    route: mockPersonalRoute,
    routeSegments: mockRouteSegments,
    showRoute: false,
    inputText: '',
    participantCount: 0,
    commentCount: 0,
  },

  onLoad() {
    this.setData({
      participantCount: mockActiveTrip.participantIds.length,
      commentCount: mockActiveTrip.commentIds.length,
    });
  },

  onInvite() {
    // Mock 邀请
    wx.showToast({ title: '邀请功能开发中', icon: 'none' });
  },

  onToggleRoute() {
    this.setData({ showRoute: !this.data.showRoute });
  },

  onInput(e: WechatMiniprogram.Input) {
    this.setData({ inputText: e.detail.value });
  },

  onSend() {
    const text = this.data.inputText.trim();
    if (!text) return;

    // Mock 发送：加入评论列表，状态先显示 processing
    const newComment: Comment = {
      id: `comment_${Date.now()}`,
      tripId: mockActiveTrip.id,
      userId: mockCurrentUser.id,
      rawText: text,
      createdAt: new Date().toISOString(),
      aiStatus: 'processing',
    };

    this.setData({
      comments: [...this.data.comments, newComment],
      inputText: '',
      commentCount: this.data.commentCount + 1,
    });

    // Mock：模拟 AI 处理，稍后标记为已纳入
    setTimeout(() => {
      const updated = this.data.comments.map((c) =>
        c.id === newComment.id ? { ...c, aiStatus: 'accepted' as const } : c
      );
      this.setData({ comments: updated });
    }, 1500);
  },

  onPlaceTap(e: WechatMiniprogram.CustomEvent) {
    const location = e.detail.location;
    if (!location) return;
    wx.navigateTo({
      url: `/pages/place-detail/place-detail?locationId=${location.id}`,
    });
  },

  onRestaurantTap(e: WechatMiniprogram.CustomEvent) {
    const restaurant = e.detail.restaurant;
    if (!restaurant) return;
    wx.navigateTo({
      url: `/pages/place-detail/place-detail?restaurantId=${restaurant.id}`,
    });
  },
});