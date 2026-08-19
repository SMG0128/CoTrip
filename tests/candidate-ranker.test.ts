// tests/candidate-ranker.test.ts
// 候选排序器单元测试：验证 Budget Planner 排序逻辑。

import { rankCandidates } from '../core/candidate-ranker';
import { Constraint } from '../types/constraint';
import { Restaurant } from '../types/restaurant';
import { realRestaurants } from '../mock/mock-real-places';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

function makeConstraint(partial: Partial<Constraint>): Constraint {
  return {
    id: `c_${Math.random().toString(36).slice(2)}`,
    tripId: 'trip_test',
    ownerId: 'user_A',
    type: 'PREFERENCE',
    scope: 'TRIP',
    priority: 'SOFT',
    value: {},
    ...partial,
  };
}

// 预算约束：人均不要超过80
const budgetConstraint: Constraint = makeConstraint({
  type: 'BUDGET',
  priority: 'SOFT',
  value: { max: 80, currency: 'CNY', unit: 'PER_PERSON' },
});

// 区域约束：最好在越秀吃
const districtConstraint: Constraint = makeConstraint({
  type: 'LOCATION',
  scope: 'DINING',
  priority: 'SOFT',
  value: { district: '越秀区' },
});

// ---- 1. 预算内优先，超预算排后 ----
{
  const ranked = rankCandidates({ restaurants: realRestaurants, constraints: [budgetConstraint] });
  assert(ranked.length === 3, '应有 3 个候选');
  // 蔡澜(51) 和 越芽(55) 在预算内，大头虾(100) 超预算
  const first = ranked[0];
  const last = ranked[ranked.length - 1];
  assert(!first.overBudget, '第一推荐不应超预算');
  assert(last.overBudget, '最后一名应为超预算备选');
  assert(last.restaurant.name.includes('大头虾'), `超预算备选应是大头虾，实际 ${last.restaurant.name}`);
}

// ---- 2. 蔡澜 Pho 应优先于越芽（价格更低） ----
{
  const ranked = rankCandidates({ restaurants: realRestaurants, constraints: [budgetConstraint] });
  const names = ranked.map((r) => r.restaurant.name);
  const cailanIdx = names.findIndex((n) => n.includes('蔡澜'));
  const yueyaIdx = names.findIndex((n) => n.includes('越芽'));
  assert(cailanIdx !== -1 && yueyaIdx !== -1, '蔡澜与越芽都应存在');
  assert(cailanIdx < yueyaIdx, `蔡澜(51) 应排在越芽(55) 之前，实际索引 ${cailanIdx} vs ${yueyaIdx}`);
}

// ---- 3. 区域约束加成 ----
{
  const ranked = rankCandidates({ restaurants: realRestaurants, constraints: [budgetConstraint, districtConstraint] });
  const first = ranked[0];
  assert(first.restaurant.location.district === '越秀区', '第一推荐应位于越秀区');
}

// ---- 4. 不写死餐厅名：逻辑基于价格/区域，而非名称 ----
{
  // 构造一个价格更低的新餐厅，验证排序逻辑通用
  const cheapRestaurant: Restaurant = {
    id: 'restaurant_cheap',
    name: '测试平价餐厅',
    location: { id: 'loc_cheap', name: '测试平价餐厅', district: '越秀区', city: '广州市' },
    categories: ['VIETNAMESE'],
    averagePrice: { amount: 30, currency: 'CNY', unit: 'PER_PERSON' },
    externalActions: [],
  };
  const ranked = rankCandidates({
    restaurants: [cheapRestaurant, ...realRestaurants],
    constraints: [budgetConstraint, districtConstraint],
  });
  assert(ranked[0].restaurant.id === 'restaurant_cheap', '价格最低且命中区域的餐厅应排第一');
}

console.log('✅ candidate-ranker.test.ts 全部通过');