// mock/mock-real-places.ts
// 真实地点 Seed 数据（Fallback）。
// 用途：Provider API 不可用时，作为真实 Seed Fallback。
// 注意：这里必须是真实地点，禁止重新引入 Restaurant A / XX球馆 等假数据。

import { Location } from '../types/location';
import { Restaurant } from '../types/restaurant';
import { ExternalAction } from '../types/external-action';

// ---- 真实羽毛球馆 ----
export const realBadmintonVenue: Location = {
  id: 'location_badminton_center',
  name: '广州羽毛球中心羽毛球馆',
  latitude: 23.13652,
  longitude: 113.322263,
  address: '广东省广州市天河区天河路299号广州天河体育中心附馆',
  district: '天河区',
  city: '广州市',
  providerRefs: [{ provider: 'tencent_map', externalId: 'poi_badminton_center' }],
};

// ---- 真实餐厅候选 ----

// Restaurant 1: 越芽越南餐室（淘金北路店）
const dianpingYueya: ExternalAction = {
  id: 'ea_yueya_dianping',
  provider: 'dianping',
  mode: 'URL',
  action: 'merchant_detail',
  target: 'https://www.dianping.com/shop/65696301',
};

export const realRestaurantYueya: Restaurant = {
  id: 'restaurant_yueya',
  name: '越芽越南餐室（淘金北路店）',
  location: {
    id: 'location_yueya',
    name: '越芽越南餐室（淘金北路店）',
    latitude: 23.1372,
    longitude: 113.2789,
    address: '广州市越秀区淘金北路17号地下室',
    district: '越秀区',
    city: '广州市',
    providerRefs: [{ provider: 'tencent_map', externalId: 'poi_yueya' }],
  },
  categories: ['VIETNAMESE'],
  averagePrice: { amount: 55, currency: 'CNY', unit: 'PER_PERSON' },
  rating: { score: 4.6, count: 3200 },
  providerRefs: [{ provider: 'dianping', externalId: '65696301' }],
  externalActions: [dianpingYueya],
};

// Restaurant 2: 蔡澜Pho·越南粉餐厅（保利·时光里店）
const dianpingCailan: ExternalAction = {
  id: 'ea_cailan_dianping',
  provider: 'dianping',
  mode: 'URL',
  action: 'merchant_detail',
  target: 'https://m.dianping.com/shop/1903864203?msource=applemaps',
};

export const realRestaurantCailan: Restaurant = {
  id: 'restaurant_cailan',
  name: '蔡澜Pho·越南粉餐厅（保利·时光里店）',
  location: {
    id: 'location_cailan',
    name: '蔡澜Pho·越南粉餐厅（保利·时光里店）',
    latitude: 23.1331,
    longitude: 113.2762,
    address: '广州市越秀区建设大马路18号时光里南塔2层',
    district: '越秀区',
    city: '广州市',
    providerRefs: [{ provider: 'tencent_map', externalId: 'poi_cailan' }],
  },
  categories: ['VIETNAMESE'],
  averagePrice: { amount: 51, currency: 'CNY', unit: 'PER_PERSON' },
  rating: { score: 4.8, count: 2100 },
  providerRefs: [{ provider: 'dianping', externalId: '1903864203' }],
  externalActions: [dianpingCailan],
};

// Restaurant 3: 大头虾·越式风味餐厅（惠福东路店）
const dianpingDatou: ExternalAction = {
  id: 'ea_datou_dianping',
  provider: 'dianping',
  mode: 'URL',
  action: 'merchant_detail',
  target: 'https://m.dianping.com/shop/751603538?msource=applemaps',
};

export const realRestaurantDatou: Restaurant = {
  id: 'restaurant_datou',
  name: '大头虾·越式风味餐厅（惠福东路店）',
  location: {
    id: 'location_datou',
    name: '大头虾·越式风味餐厅（惠福东路店）',
    latitude: 23.1245,
    longitude: 113.2701,
    address: '广州市越秀区惠福东路548号',
    district: '越秀区',
    city: '广州市',
    providerRefs: [{ provider: 'tencent_map', externalId: 'poi_datou' }],
  },
  categories: ['VIETNAMESE'],
  averagePrice: { amount: 100, currency: 'CNY', unit: 'PER_PERSON' },
  rating: { score: 4.7, count: 5600 },
  providerRefs: [{ provider: 'dianping', externalId: '751603538' }],
  externalActions: [dianpingDatou],
};

/** 全部真实餐厅候选 */
export const realRestaurants: Restaurant[] = [
  realRestaurantCailan,
  realRestaurantYueya,
  realRestaurantDatou,
];

/** 全部真实地点（球馆 + 餐厅） */
export const realLocations: Location[] = [
  realBadmintonVenue,
  ...realRestaurants.map((r) => r.location),
];
