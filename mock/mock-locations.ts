// mock/mock-locations.ts
// Mock 地点数据

import { Location } from '../types/location';

export const mockBadmintonVenue: Location = {
  id: 'location_badminton',
  name: 'XX 羽毛球馆',
  latitude: 23.129,
  longitude: 113.324,
  address: '广州市天河区体育西路',
  district: '天河区',
  city: '广州市',
  providerRefs: { tencent_map: 'poi_badminton' },
};

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

export const mockRestaurantLocation: Location = {
  id: 'location_restaurant',
  name: 'XX 越南料理',
  latitude: 23.118,
  longitude: 113.268,
  address: '广州市越秀区北京路',
  district: '越秀区',
  city: '广州市',
  providerRefs: { tencent_map: 'poi_restaurant' },
};