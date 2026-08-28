// pages/profile/profile.ts
// 我的页：极简，展示微信信息与通知设置。

import { Participant } from '../../types/participant';
import { authService } from '../../services/index';

interface NotificationSetting {
  key: string;
  label: string;
  enabled: boolean;
  icon: string;
}

Page({
  data: {
    user: null as Participant | null,
    tripCount: 2,
    settings: [
      { key: 'trip_starting', label: '行程开始提醒', enabled: true, icon: '/assets/icons/settings/calendar.svg' },
      { key: 'departure', label: '建议出发时间提醒', enabled: true, icon: '/assets/icons/settings/clock.svg' },
      { key: 'plan_changed', label: '计划重大变化提醒', enabled: true, icon: '/assets/icons/settings/route.svg' },
      { key: 'conflict', label: '冲突提醒', enabled: false, icon: '/assets/icons/settings/warning.svg' },
    ] as NotificationSetting[],
  },

  onShow() {
    const tabBar = this.getTabBar();
    if (tabBar) {
      tabBar.setData({ selected: 1 });
    }

    // 从全局读取当前登录用户
    const app = getApp<IAppOption>();
    this.setData({ user: app.globalData.currentUser });
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

  onEditProfile() {
    wx.navigateTo({ url: '/pages/profile-setup/profile-setup?mode=edit' });
  },

  onDeparturePlaces() {
    wx.navigateTo({ url: '/pages/departure-places/departure-places' });
  },

  onPrivacy() {
    wx.showModal({
      title: '隐私说明',
      content: '个人出发地点默认只用于计算个人路线，不向其他参与者公开。',
      showCancel: false,
    });
  },

  async onLogout() {
    const { confirm } = await new Promise<{ confirm: boolean }>((resolve) => {
      wx.showModal({
        title: '退出登录',
        content: '确定要退出当前账号吗？',
        success: resolve,
      });
    });
    if (!confirm) return;
    try {
      // 清除本地登录态（token/用户缓存）；之后登录页重新 restoreSession 必然得到未登录
      await authService.logout();
    } finally {
      // 即使清除过程异常也强制回到微信登录界面，避免停留在半退出状态
      const app = getApp<IAppOption>();
      app.globalData.currentUser = null;
      wx.reLaunch({ url: '/pages/login/login' });
    }
  },
});
