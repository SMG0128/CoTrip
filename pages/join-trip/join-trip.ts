// pages/join-trip/join-trip.ts
// V0.3 UI Foundation：微信分享卡片落地页。
// 当前阶段仅做 UI foundation：解析 roomCode 并展示，不调用任何真实 Join API，
// 不写入 participantIds，不假装加入成功。后续 Backend Room API 接通后再接入。

import { resolveRoomCodeDisplay } from '../../utils/trip-share';

Page({
  data: {
    roomCode: '',
  },

  onLoad(options?: Record<string, string | undefined>) {
    const raw = options?.roomCode ?? '';
    let roomCode = raw.trim();
    try {
      roomCode = decodeURIComponent(roomCode).trim();
    } catch {
      // 非法编码时保留原始值，避免 decodeURIComponent 抛错导致页面白屏
    }
    this.setData({ roomCode: resolveRoomCodeDisplay(roomCode) });
  },

  onJoin() {
    wx.showToast({
      title: '多人加入功能即将接通',
      icon: 'none',
    });
  },
});
