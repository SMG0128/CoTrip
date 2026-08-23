// pages/join-trip/join-trip.ts
// 微信邀请与首页房间码入口统一落到这里：先预览，再由用户明确确认加入。

import { tripService } from '../../services/index';
import { TripJoinPreview } from '../../services/trip-service';
import { runJoinAction } from '../../utils/join-flow';
import {
  clearPendingJoinRoomCode,
  setPendingJoinRoomCode,
} from '../../utils/pending-join';
import { isValidRoomCode, parseRoomCodeParam } from '../../utils/room-code';

type JoinPageState =
  | 'loading'
  | 'valid'
  | 'invalid'
  | 'not-found'
  | 'not-joinable'
  | 'joining'
  | 'join-failed'
  | 'failed';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

Page({
  data: {
    roomCode: '',
    preview: null as TripJoinPreview | null,
    pageState: 'loading' as JoinPageState,
    joining: false,
    errorText: '',
  },

  onLoad(options?: Record<string, string | undefined>) {
    const roomCode = parseRoomCodeParam(options?.roomCode);
    this.setData({ roomCode });

    if (!isValidRoomCode(roomCode)) {
      this.setData({
        pageState: 'invalid',
        errorText: '房间号格式不正确，请检查后重试',
      });
      return;
    }

    this.loadPreview();
  },

  async loadPreview(): Promise<void> {
    this.setData({ pageState: 'loading', preview: null, errorText: '' });
    try {
      const preview = await tripService.getJoinPreview(this.data.roomCode);
      if (!preview) {
        this.setData({
          pageState: 'not-found',
          errorText: '未找到对应行程，请向邀请人确认房间号',
        });
        return;
      }
      if (preview.status !== 'ACTIVE') {
        this.setData({
          preview,
          pageState: 'not-joinable',
          errorText: '该行程当前不可加入',
        });
        return;
      }
      this.setData({ preview, pageState: 'valid' });
    } catch (error) {
      this.setData({
        pageState: 'failed',
        errorText: errorMessage(error, '邀请加载失败，请稍后重试'),
      });
    }
  },

  async onJoin(): Promise<void> {
    if (
      (this.data.pageState !== 'valid' && this.data.pageState !== 'join-failed')
      || this.data.joining
    ) return;

    const app = getApp<IAppOption>();
    const isLoggedIn = !!app.globalData.currentUser;
    if (isLoggedIn) this.setData({ pageState: 'joining', joining: true, errorText: '' });

    try {
      await runJoinAction({
        roomCode: this.data.roomCode,
        currentUser: app.globalData.currentUser,
        joinTrip: (roomCode) => tripService.joinTrip(roomCode),
        savePending: setPendingJoinRoomCode,
        clearPending: clearPendingJoinRoomCode,
        goToLogin: () => wx.redirectTo({ url: '/pages/login/login' }),
        goToTripDetail: (tripId) =>
          wx.redirectTo({
            url: `/pages/trip-detail/trip-detail?tripId=${encodeURIComponent(tripId)}`,
          }),
      });
    } catch (error) {
      const message = errorMessage(error, '加入失败，请稍后重试');
      this.setData({ pageState: 'join-failed', joining: false, errorText: message });
      wx.showToast({ title: message, icon: 'none' });
      return;
    }

    this.setData({ joining: false });
  },
});
