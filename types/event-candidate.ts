// types/event-candidate.ts
// 事件候选展示模型：将地点/餐厅候选归属到具体 PlanEvent，不参与规划核心计算。

import { Location } from './location';
import { Price } from './price';
import { Restaurant } from './restaurant';

export type EventCandidateKind = 'PLACE' | 'RESTAURANT';

export interface EventCandidate {
  id: string;
  eventId: string;
  kind: EventCandidateKind;
  name: string;
  location: Location;
  restaurant?: Restaurant;
  price?: Price;
  rating?: number;
  /** 来自候选排序器的结构化得分，越高越优先。 */
  score?: number;
  /** 由 score 映射的展示置信度，不回写 Planning Core。 */
  confidence?: number;
  rank: number;
  selected: boolean;
  overBudget?: boolean;
  reasons?: string[];
}

export interface EventCandidateGroup {
  eventId: string;
  candidates: EventCandidate[];
}
