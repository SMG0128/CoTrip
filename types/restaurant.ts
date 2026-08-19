// types/restaurant.ts
// 餐厅实体

import { Location } from './location';
import { Price } from './price';
import { ExternalAction } from './external-action';

export interface Restaurant {
  id: string;
  name: string;
  location: Location;
  categories: string[];
  averagePrice?: Price;
  rating?: {
    score: number;
    count?: number;
  };
  externalActions: ExternalAction[];
}