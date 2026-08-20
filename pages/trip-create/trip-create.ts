// pages/trip-create/trip-create.ts
// 新建行程页：区域限定、时间范围、事件简述、创建。
// 所有权：新 Trip 的 creatorId / 默认 participant 一律来自当前真实登录用户 currentUser.id，
// 绝不使用 Mock 占位身份（user_A / mockDevCurrentUser）。

import { AreaConstraint } from '../../types/constraint';
import { TimeRange } from '../../types/time';
import { tripService } from '../../services/index';
import { requireCurrentUser } from '../../utils/current-user';

Page({
  data: {
    areaText: '不限区域',
    areaConstraint: { unrestricted: true } as AreaConstraint,
    startDate: '',
    startTime: '',
    endDate: '',
    endTime: '',
    brief: '',
  },

  onAreaTap() {
    // Mock 选择器：未来支持指定地点 / 指定区域 / 地图范围
    wx.showActionSheet({
      itemList: ['不限区域', '指定行政区域', '指定地点', '地图范围'],
      success: (res) => {
        const options = ['不限区域', '指定行政区域', '指定地点', '地图范围'];
        const label = options[res.tapIndex];
        const constraint: AreaConstraint =
          res.tapIndex === 0
            ? { unrestricted: true }
            : res.tapIndex === 1
              ? { district: '天河区', city: '广州市' }
              : res.tapIndex === 2
                ? { location: { id: 'loc_pick', name: '天河体育中心' } }
                : { mapBounds: { northeast: { latitude: 0, longitude: 0 }, southwest: { latitude: 0, longitude: 0 } } };
        this.setData({ areaText: label, areaConstraint: constraint });
      },
    });
  },

  onStartDateChange(e: WechatMiniprogram.Input) {
    this.setData({ startDate: e.detail.value });
  },
  onStartTimeChange(e: WechatMiniprogram.Input) {
    this.setData({ startTime: e.detail.value });
  },
  onEndDateChange(e: WechatMiniprogram.Input) {
    this.setData({ endDate: e.detail.value });
  },
  onEndTimeChange(e: WechatMiniprogram.Input) {
    this.setData({ endTime: e.detail.value });
  },

  onBriefInput(e: WechatMiniprogram.Input) {
    this.setData({ brief: e.detail.value });
  },

  onCreate() {
    const { startDate, startTime, endDate, endTime, brief, areaConstraint } = this.data;

    const timeRange: TimeRange | undefined =
      startDate && startTime
        ? {
            start: `${startDate}T${startTime}:00+08:00`,
            end: endDate && endTime ? `${endDate}T${endTime}:00+08:00` : undefined,
            timezone: 'Asia/Shanghai',
          }
        : undefined;

    // 登录守卫：NO AUTH → NO REAL USER OWNERSHIP ACTION
    // 无 currentUser 时禁止创建，绝不回退到 user_A / mockDevCurrentUser。
    const app = getApp<IAppOption>();
    const guard = requireCurrentUser(app.globalData.currentUser);
    if (!guard.ok) {
      wx.showToast({ title: '登录状态失效，请先登录', icon: 'none' });
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }

    // 真实创建：creatorId = currentUser.id，默认 participant = [currentUser.id]
    // 新 Trip 天然属于真实用户，无需任何 Mock 身份或 runtime hydration。
    const title = brief.trim() ? brief.trim() : '新行程';
    tripService
      .createTrip({
        title,
        creatorId: guard.user.id,
        initialBrief: brief.trim(),
        areaConstraint,
        timeRange,
      })
      .then((trip) => {
        wx.showToast({ title: '行程已创建', icon: 'success' });
        setTimeout(() => {
          wx.navigateTo({ url: `/pages/trip-detail/trip-detail?tripId=${trip.id}` });
        }, 500);
      })
      .catch(() => {
        wx.showToast({ title: '行程创建失败，请稍后重试', icon: 'none' });
      });
  },
});
