// pages/profile/profile.ts
// 我的页：极简，展示微信信息与通知设置。

import { mockCurrentUser } from '../../mock/mock-user';

interface NotificationSetting {
  key: string;
  label: string;
  enabled: boolean;
}

Page({
  data: {
    user: mockCurrentUser,
    tripCount: 2,
    settings: [
      { key: 'trip_starting', label: '行程开始提醒', enabled: true },
      { key: 'departure', label: '建议出发时间提醒', enabled: true },
      { key: 'plan_changed', label: '计划重大变化提醒', enabled: true },
      { key: 'conflict', label: '冲突提醒', enabled: false },
    ] as NotificationSetting[],
  },

  onToggle(e: WechatMiniprogram.BaseEvent) {
    const key = e.currentTarget.dataset.key;
    const settings = this.data.settings.map((s) =>
      s.key === key ? { ...s, enabled: !s.enabled } : s
    );
    this.setData({ settings });
  },

  onAbout() {
    wx.showModal({
      title: '关于 CoTrip',
      content: '大家负责表达想法，AI 负责把想法变成共同计划。',
      showCancel: false,
    });
  },

  onPrivacy() {
    wx.showModal({
      title: '隐私说明',
      content: '个人出发地点默认只用于计算个人路线，不向其他参与者公开。',
      showCancel: false,
    });
  },
});