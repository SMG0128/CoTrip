// 事件候选展示映射测试：验证候选归属、排名与已确认选择。

import { rankCandidates } from '../core/candidate-ranker';
import { mockPlan } from '../mock/mock-plan';
import { realRestaurants, realRestaurantYueya } from '../mock/mock-real-places';
import { Plan } from '../types/plan';
import { buildEventCandidateGroups } from '../utils/event-candidates';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

const ranked = rankCandidates({ restaurants: realRestaurants, constraints: [] });

// SPORT 与 DINING 候选都归属于对应事件。
{
  const groups = buildEventCandidateGroups(mockPlan, ranked);
  const sport = groups.find((group) => group.eventId === 'event_badminton');
  const dining = groups.find((group) => group.eventId === 'event_dining');
  assert(sport?.candidates.length === 1, '球馆应归属于 SPORT 事件');
  assert(dining?.candidates.length === 3, '餐厅候选应归属于 DINING 事件');
  assert(dining?.candidates[0].rank === 1, '第一候选必须来自结构化排名第一位');
  assert((dining?.candidates[0].score ?? -1) >= (dining?.candidates[1].score ?? 0), '候选应按 score 降序');
}

// 已确认选择优先作为当前选择，即使它不是排名第一。
{
  const plan: Plan = {
    ...mockPlan,
    events: mockPlan.events.map((event) =>
      event.id === 'event_dining'
        ? { ...event, location: realRestaurantYueya.location, restaurant: realRestaurantYueya }
        : event
    ),
  };
  const dining = buildEventCandidateGroups(plan, ranked)
    .find((group) => group.eventId === 'event_dining');
  const selected = dining?.candidates.find((candidate) => candidate.selected);
  assert(selected?.id === realRestaurantYueya.id, '已确认餐厅必须保持当前选择');
}

console.log('✅ event-candidates.test.ts 全部通过');
