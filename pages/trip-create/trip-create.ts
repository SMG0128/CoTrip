// pages/trip-create/trip-create.ts
// 新建行程页：区域限定、时间范围、事件简述、创建。

import { AreaConstraint } from '../../types/constraint';
import { TimeRange } from '../../types/time';
import { mockCurrentUser } from '../../mock/mock-user';

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

    // Mock 创建：直接进入行程详情
    console.log('[MockCreate]', { brief, areaConstraint, timeRange });

    wx.showToast({ title: '行程已创建', icon: 'success' });
    setTimeout(() => {
      wx.navigateTo({ url: '/pages/trip-detail/trip-detail' });
    }, 500);
  },
});