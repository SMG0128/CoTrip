// mock/mock-locations.ts
// 地点数据：引用真实地点 Seed（mock-real-places）。
// 不再使用 XX 羽毛球馆 / Restaurant A 等假数据。

import { Location } from '../types/location';
import { realBadmintonVenue, realRestaurantYueya } from './mock-real-places';

export const mockBadmintonVenue: Location = realBadmintonVenue;

export const mockMetroStation: Location = {
  id: 'location_metro',
  name: '体育西路地铁站',
  district: '天河区',
  city: '广州市',
};

export const mockHome: Location = {
  id: 'location_home',
  name: '当前位置',
  city: '广州市',
};

export const mockRestaurantLocation: Location = realRestaurantYueya.location;