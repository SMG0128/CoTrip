// mock/mock-restaurants.ts
// 餐厅数据：引用真实餐厅 Seed（mock-real-places）。
// 不再使用 Restaurant A / B / C 假数据。

import { Restaurant } from '../types/restaurant';
import { realRestaurants } from './mock-real-places';

export const mockRestaurants: Restaurant[] = realRestaurants;