// pages/place-detail/place-detail.ts
// 地点详情页：展示地点信息与第三方 Action 占位。

import { mockRestaurants } from '../../mock/mock-restaurants';
import { mockBadmintonVenue, mockRestaurantLocation } from '../../mock/mock-locations';
import { Restaurant } from '../../types/restaurant';
import { Location } from '../../types/location';
import { ExternalAction } from '../../types/external-action';
import { Price } from '../../types/price';
import { externalActionService } from '../../services/index';

Page({
  data: {
    name: '',
    rating: '',
    price: null as Price | null,
    district: '',
    reason: '',
    actions: [] as ExternalAction[],
  },

  onLoad(options: Record<string, string>) {
    const { locationId, restaurantId } = options;

    if (restaurantId) {
      const r = mockRestaurants.find((x) => x.id === restaurantId);
      if (r) this.renderRestaurant(r);
      return;
    }

    if (locationId) {
      const loc = [mockBadmintonVenue, mockRestaurantLocation].find((l) => l.id === locationId);
      if (loc) this.renderLocation(loc);
    }
  },

  renderRestaurant(r: Restaurant) {
    this.setData({
      name: r.name,
      rating: r.rating ? String(r.rating.score) : '',
      price: r.averagePrice ?? null,
      district: r.location.district ?? '',
      reason: '价格符合预算要求，同时满足在越秀区吃饭的需求。',
      actions: r.externalActions,
    });
  },

  renderLocation(loc: Location) {
    this.setData({
      name: loc.name,
      district: loc.district ?? '',
      reason: '该地点符合区域与时间要求。',
      actions: [
        {
          id: 'ea_map',
          provider: 'tencent_map',
          mode: 'MAP',
          action: 'open_location',
          params: { latitude: loc.latitude, longitude: loc.longitude, name: loc.name },
        },
      ],
    });
  },

  onActionTap(e: WechatMiniprogram.BaseEvent) {
    const action = e.currentTarget.dataset.action as ExternalAction;
    // Mock：仅提示，不真正跳转
    externalActionService.execute(action);
    wx.showToast({ title: `${externalActionService.describe(action)}（Mock）`, icon: 'none' });
  },
});