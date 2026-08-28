// pages/departure-places/departure-places.ts
// 出发设置：管理默认出发地点（「我的推荐」的起始地点候选）。
// 每个地址唯一添加方式：地图选点（wx.chooseLocation）；首位为默认出发点。

import { Location } from '../../types/location';
import {
  buildDeparturePlace,
  loadDeparturePlaces,
  mergeDeparturePlace,
  removeDeparturePlace,
  saveDeparturePlaces,
} from '../../utils/departure-places';

Page({
  data: {
    places: [] as Location[],
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    this.setData({ places: loadDeparturePlaces() });
  },

  /** 唯一添加方式：打开微信地图选点 */
  onAddPlace() {
    wx.chooseLocation({
      success: (res) => {
        const place = buildDeparturePlace({
          name: res.name,
          address: res.address,
          latitude: res.latitude,
          longitude: res.longitude,
        });
        saveDeparturePlaces(mergeDeparturePlace(loadDeparturePlaces(), place));
        this.refresh();
        wx.showToast({ title: '已保存出发地点', icon: 'success' });
      },
      fail: (err) => {
        if (err.errMsg && err.errMsg.includes('cancel')) return;
        wx.showToast({ title: '打开地图失败，请检查定位授权', icon: 'none' });
      },
    });
  },

  onDeletePlace(e: WechatMiniprogram.BaseEvent) {
    const id = e.currentTarget.dataset.id as string;
    const target = this.data.places.find((item) => item.id === id);
    if (!target) return;
    wx.showModal({
      title: '删除出发地点',
      content: `确定删除「${target.name}」吗？`,
      confirmColor: '#e5484d',
      success: (res) => {
        if (!res.confirm) return;
        saveDeparturePlaces(removeDeparturePlace(loadDeparturePlaces(), id));
        this.refresh();
      },
    });
  },
});
