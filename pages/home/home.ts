// pages/home/home.ts
// 首页：展示进行中行程或推荐模式。

import { Trip } from '../../types/trip';
import { tripService } from '../../services/index';
import { hydrateTripWithCurrentUser } from '../../utils/current-user';
import { extractRoomCodeFromText, normalizeRoomCode } from '../../utils/room-code';
import { mergeHomeTrips } from '../../utils/demo-trip';

const DEFAULT_HOME_TOP_INSET_PX = 88;

Page({
  data: {
    user: null as import('../../types/participant').Participant | null,
    activeTrips: [] as Trip[],
    hasActiveTrips: false,
    roomCodeInput: '',
    // 仅约束前景内容；轮播背景仍从屏幕物理顶边开始铺设。
    homeTopInsetPx: DEFAULT_HOME_TOP_INSET_PX,
    homeBanners: [
      {
        id: 'canton-tower',
        imageUrl: '/assets/home/guangzhou-canton-tower.jpg',
      },
      {
        id: 'shamian',
        imageUrl: '/assets/home/guangzhou-shamian.jpg',
      },
      {
        id: 'zhujiang-new-town',
        imageUrl: '/assets/home/guangzhou-zhujiang-new-town.jpg',
      },
    ],
  },

  onLoad() {
    this.syncHomeTopInset();
    // 剪贴板若含房间号，自动填入输入框，减少手动输入成本
    this.tryAutoFillRoomCode();
  },

  /** 自定义导航下只给可点击内容留隐形安全区，背景图不参与避让。 */
  syncHomeTopInset() {
    let homeTopInsetPx = DEFAULT_HOME_TOP_INSET_PX;
    try {
      const windowInfo = wx.getWindowInfo();
      const menuButton = wx.getMenuButtonBoundingClientRect();
      const navigationGap = Math.max(menuButton.top - windowInfo.statusBarHeight, 6);
      homeTopInsetPx = Math.ceil(menuButton.bottom + navigationGap);
    } catch {
      // 极少数旧基础库无法读取胶囊位置时使用稳定兜底值。
    }
    if (homeTopInsetPx !== this.data.homeTopInsetPx) {
      this.setData({ homeTopInsetPx });
    }
  },

  onResize() {
    this.syncHomeTopInset();
  },

  /** 读取剪贴板并匹配房间号；匹配到且输入框为空时自动填入。 */
  tryAutoFillRoomCode() {
    if (this.data.roomCodeInput) return;
    wx.getClipboardData({
      success: (res) => {
        if (this.data.roomCodeInput) return;
        const code = extractRoomCodeFromText(res.data);
        if (!code) return;
        this.setData({ roomCodeInput: code });
        wx.showToast({ title: '已自动填入房间号', icon: 'none' });
      },
      fail: () => {
        // 剪贴板不可读（未授权等）时静默忽略，仍可手动输入
      },
    });
  },

  onRoomCodeFocus() {
    // 聚焦输入框时再尝试一次：首次授权失败后用户再次点击可补上自动填入
    this.tryAutoFillRoomCode();
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
