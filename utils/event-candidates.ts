// utils/event-candidates.ts
// 将结构化排名结果适配为按事件归属的通用候选展示数据。

import { RankedCandidate } from '../core/candidate-ranker';
import { EventCandidate, EventCandidateGroup } from '../types/event-candidate';
import { Plan } from '../types/plan';
import { Restaurant } from '../types/restaurant';

function toConfidence(score: number): number {
  return Math.max(50, Math.min(99, Math.round(50 + score * 4)));
}

export function buildEventCandidateGroups(
  plan: Plan | undefined,
  rankedRestaurants: RankedCandidate[]
): EventCandidateGroup[] {
  if (!plan) return [];
  return plan.events
    .map((event): EventCandidateGroup | null => {
      if (event.type === 'DINING' && rankedRestaurants.length) {
        const ranked = [...rankedRestaurants].sort((a, b) => {
          if (a.overBudget !== b.overBudget) return a.overBudget ? 1 : -1;
          return b.score - a.score;
        });
        const confirmedId = event.restaurant?.id;
        const preferredId = confirmedId ?? ranked[0].restaurant.id;
        const candidates: EventCandidate[] = ranked.map((item, index) => ({
          id: item.restaurant.id,
          eventId: event.id,
          kind: 'RESTAURANT',
          name: item.restaurant.name,
          location: item.restaurant.location,
          restaurant: item.restaurant,
          price: item.restaurant.averagePrice,
          rating: item.restaurant.rating?.score,
          score: item.score,
          confidence: toConfidence(item.score),
          rank: index + 1,
          selected: item.restaurant.id === preferredId,
          overBudget: item.overBudget,
          reasons: item.reasons,
        }));
        return { eventId: event.id, candidates };
      }

      // 真实餐厅候选（服务端 Provider 验证，top 已写入 event.restaurant）：
      // 全部展示为备选，选中项与 event.restaurant 一致 →「当前首选」+「查看 N 个备选」
      if (event.restaurantCandidates && event.restaurantCandidates.length > 0) {
        const preferredId = event.restaurant?.id ?? event.restaurantCandidates[0].id;
        const candidates: EventCandidate[] = event.restaurantCandidates.map((item, index) => ({
          id: item.id,
          eventId: event.id,
          kind: 'RESTAURANT',
          name: item.name,
          location: item.location,
          restaurant: item as Restaurant,
          price: item.averagePrice,
          rating: item.rating?.score,
          confidence: 99,
          rank: index + 1,
          selected: item.id === preferredId,
        }));
        return { eventId: event.id, candidates };
      }

      if (event.restaurant) {
        return {
          eventId: event.id,
          candidates: [{
            id: event.restaurant.id,
            eventId: event.id,
            kind: 'RESTAURANT',
            name: event.restaurant.name,
            location: event.restaurant.location,
            restaurant: event.restaurant,
            price: event.restaurant.averagePrice,
            rating: event.restaurant.rating?.score,
            confidence: 99,
            rank: 1,
            selected: true,
          }],
        };
      }

      if (event.location) {
        return {
          eventId: event.id,
          candidates: [{
            id: event.location.id,
            eventId: event.id,
            kind: 'PLACE',
            name: event.location.name,
            location: event.location,
            price: event.price,
            confidence: 99,
            rank: 1,
            selected: true,
          }],
        };
      }

      return null;
    })
    .filter((group): group is EventCandidateGroup => group !== null);
}
