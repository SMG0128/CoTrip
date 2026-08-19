interface TabItem {
  pagePath: string;
  text: string;
  iconPath: string;
  selectedIconPath: string;
}

Component({
  data: {
    selected: 0,
    list: [
      {
        pagePath: 'pages/home/home',
        text: '首页',
        iconPath: '/assets/icons/nav/home-muted.svg',
        selectedIconPath: '/assets/icons/nav/home.svg',
      },
      {
        pagePath: 'pages/profile/profile',
        text: '我的',
        iconPath: '/assets/icons/nav/profile-muted.svg',
        selectedIconPath: '/assets/icons/nav/profile.svg',
      },
    ] as TabItem[],
  },

  lifetimes: {
    attached() {
      this.syncSelected();
    },
  },

  pageLifetimes: {
    show() {
      this.syncSelected();
    },
  },

  methods: {
    syncSelected() {
      const pages = getCurrentPages();
      const route = pages[pages.length - 1]?.route ?? '';
      const selected = this.data.list.findIndex((item) => item.pagePath === route);
      if (selected >= 0 && selected !== this.data.selected) {
        this.setData({ selected });
      }
    },

    onSwitchTab(e: WechatMiniprogram.BaseEvent) {
      const index = Number(e.currentTarget.dataset.index);
      const item = this.data.list[index] as TabItem | undefined;
      if (!item || index === this.data.selected) return;

      this.setData({ selected: index });
      wx.switchTab({ url: '/' + item.pagePath });
    },
  },
});
