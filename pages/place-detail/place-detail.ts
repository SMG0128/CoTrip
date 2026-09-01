// pages/place-detail/place-detail.ts
// 地点详情页：展示真实地点信息与三种真实世界 Action（查看地图 / 怎么去 / 大众点评）。
// 页面不判断 provider，只调用 externalActionService.execute(action)。

import { realLocations, realRestaurants } from '../../mock/mock-real-places';
import { Restaurant } from '../../types/restaurant';
import { Location } from '../../types/location';
import { ExternalAction, ApiExternalAction, UrlExternalAction } from '../../types/external-action';
import { Price } from '../../types/price';
import { externalActionService } from '../../services/index';
import { tencentMapUriBuilder } from '../../services/providers/tencent-map-uri-builder';

interface ActionButton {
  key: string;
  label: string;
  icon: string;
  action: ExternalAction;
}

Page({
  data: {
    name: '',
    rating: '',
    price: null as Price | null,
    district: '',
    address: '',
    reason: '',
    actionButtons: [] as ActionButton[],
  },

  onLoad(options: Record<string, string>) {
    const { locationId, restaurantId, kind, entity } = options;

    // 真实链路：上游直接携带实体数据跳转，避免依赖本地 mock 表回查
    if (entity) {
      try {
        const parsed = JSON.parse(decodeURIComponent(entity)) as Record<string, unknown>;
        if (kind === 'restaurant') this.renderRestaurant(parsed as unknown as Restaurant);
        else if (kind === 'location') this.renderLocation(parsed as unknown as Location);
        return;
      } catch {
        // 解析失败回退到下方 id 查询
      }
    }

    // 旧链路 / 示例行程 fixture：按 id 回查本地 fixture
    if (restaurantId) {
      const r = realRestaurants.find((x) => x.id === restaurantId);
      if (r) this.renderRestaurant(r);
      return;
    }

    if (locationId) {
      const loc = realLocations.find((l) => l.id === locationId);
      if (loc) this.renderLocation(loc);
    }
  },

  renderRestaurant(r: Restaurant) {
    const buttons = this.buildRestaurantButtons(r);
    this.setData({
      name: r.name,
      rating: r.rating?.score ? String(r.rating.score) : '',
      price: r.averagePrice ?? null,
      district: r.location.district ?? '',
      address: r.location.address ?? '',
      reason: '',
      actionButtons: buttons,
    });
  },

  renderLocation(loc: Location) {
    const buttons = this.buildLocationButtons(loc);
    this.setData({
      name: loc.name,
      district: loc.district ?? '',
      address: loc.address ?? '',
      reason: '该地点符合区域与时间要求。',
      actionButtons: buttons,
    });
  },

  /** 构建餐厅 Action 按钮：查看地图 / 怎么去 / 大众点评（存在才显示） */
  buildRestaurantButtons(r: Restaurant): ActionButton[] {
    const buttons: ActionButton[] = [];
    const loc = r.location;

    // 查看地图：优先真实经纬度 → 微信地图能力
    if (typeof loc.latitude === 'number' && typeof loc.longitude === 'number') {
      buttons.push({
        key: 'map',
        label: '查看地图',
        icon: '/assets/icons/utility/location.svg',
        action: {
          id: `ea_map_${r.id}`,
          provider: 'tencent_map',
          mode: 'API',
          action: 'open_location',
          params: { latitude: loc.latitude, longitude: loc.longitude, name: loc.name },
        } as ApiExternalAction,
      });
    }

    // 怎么去：基于真实经纬度 → 路线规划
    if (typeof loc.latitude === 'number' && typeof loc.longitude === 'number') {
      buttons.push({
        key: 'route',
        label: '怎么去',
        icon: '/assets/icons/utility/arrow-right.svg',
        action: {
          id: `ea_route_${r.id}`,
          provider: 'tencent_map',
          mode: 'API',
          action: 'open_route',
          params: { to: { latitude: loc.latitude, longitude: loc.longitude } },
        } as ApiExternalAction,
      });
    }

    // 大众点评：仅当 externalActions 存在 dianping URL 时显示（服务端腾讯结果无此字段时自然隐藏）
    const dianping = (r.externalActions ?? []).find(
      (a) => a.provider === 'dianping' && a.mode === 'URL'
    ) as UrlExternalAction | undefined;
    if (dianping) {
      buttons.push({
        key: 'dianping',
        label: '大众点评',
        icon: '/assets/icons/utility/star.svg',
        action: dianping,
      });
    }

    return buttons;
  },

  /** 构建地点 Action 按钮 */
  buildLocationButtons(loc: Location): ActionButton[] {
    const buttons: ActionButton[] = [];

    if (typeof loc.latitude === 'number' && typeof loc.longitude === 'number') {
      buttons.push({
        key: 'map',
        label: '查看地图',
        icon: '/assets/icons/utility/location.svg',
        action: {
          id: `ea_map_${loc.id}`,
          provider: 'tencent_map',
          mode: 'API',
          action: 'open_location',
          params: { latitude: loc.latitude, longitude: loc.longitude, name: loc.name },
        } as ApiExternalAction,
      });
      buttons.push({
        key: 'route',
        label: '怎么去',
        icon: '/assets/icons/utility/arrow-right.svg',
        action: {
          id: `ea_route_${loc.id}`,
          provider: 'tencent_map',
          mode: 'API',
          action: 'open_route',
          params: { to: { latitude: loc.latitude, longitude: loc.longitude } },
        } as ApiExternalAction,
      });
    }

    return buttons;
  },

  onActionTap(e: WechatMiniprogram.BaseEvent) {
    const button = e.currentTarget.dataset.button as ActionButton;
    if (!button) return;
    externalActionService.execute(button.action);
  },
});
