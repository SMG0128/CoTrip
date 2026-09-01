// types/restaurant.ts
// 餐厅实体：独立存在，不依赖大众点评 URL 作为唯一身份。

import { Location, ProviderRef } from './location';
import { Price } from './price';
import { ExternalAction } from './external-action';

export interface Restaurant {
  id: string;
  name: string;
  location: Location;
  categories: string[];
  /** 与锚点的距离（米）；仅腾讯真实返回时存在 */
  distanceMeters?: number;
  averagePrice?: Price;
  rating?: {
    score: number;
    count?: number;
  };
  /** Provider 身份引用 */
  providerRefs?: ProviderRef[];
  externalActions: ExternalAction[];
}