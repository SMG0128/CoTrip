// utils/event-candidates.ts
// 将结构化排名结果适配为按事件归属的通用候选展示数据。

import { RankedCandidate } from '../core/candidate-ranker';
import { EventCandidate, EventCandidateGroup } from '../types/event-candidate';
import { Plan } from '../types/plan';

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
