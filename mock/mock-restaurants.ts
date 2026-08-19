// mock/mock-restaurants.ts
// Mock 餐厅数据

import { Restaurant } from '../types/restaurant';
import { mockRestaurantLocation } from './mock-locations';

export const mockRestaurants: Restaurant[] = [
  {
    id: 'restaurant_a',
    name: 'Restaurant A',
    location: { ...mockRestaurantLocation, id: 'loc_rest_a', name: 'Restaurant A' },
    categories: ['VIETNAMESE'],
    averagePrice: { amount: 42, currency: 'CNY', unit: 'PER_PERSON' },
    rating: { score: 4.7, count: 1253 },
    externalActions: [
      {
        id: 'ea_rest_a_map',
        provider: 'tencent_map',
        mode: 'MAP',
        action: 'open_location',
        params: { latitude: 23.118, longitude: 113.268, name: 'Restaurant A' },
      },
      {
        id: 'ea_rest_a_dianping',
        provider: 'dianping',
        mode: 'URL',
        target: 'https://www.dianping.com/restaurant_a',
      },
    ],
  },
  {
    id: 'restaurant_b',
    name: 'Restaurant B',
    location: { ...mockRestaurantLocation, id: 'loc_rest_b', name: 'Restaurant B' },
    categories: ['VIETNAMESE'],
    averagePrice: { amount: 51, currency: 'CNY', unit: 'PER_PERSON' },
    rating: { score: 4.8, count: 986 },
    externalActions: [
      {
        id: 'ea_rest_b_map',
        provider: 'tencent_map',
        mode: 'MAP',
        action: 'open_location',
        params: { latitude: 23.118, longitude: 113.268, name: 'Restaurant B' },
      },
    ],
  },
  {
    id: 'restaurant_c',
    name: 'Restaurant C',
    location: { ...mockRestaurantLocation, id: 'loc_rest_c', name: 'Restaurant C' },
    categories: ['VIETNAMESE'],
    averagePrice: { amount: 38, currency: 'CNY', unit: 'PER_PERSON' },
    rating: { score: 4.5, count: 2104 },
    externalActions: [
      {
        id: 'ea_rest_c_map',
        provider: 'tencent_map',
        mode: 'MAP',
        action: 'open_location',
        params: { latitude: 23.118, longitude: 113.268, name: 'Restaurant C' },
      },
    ],
  },
];