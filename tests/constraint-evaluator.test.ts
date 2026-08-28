import { evaluateConstraintAgainstPlan } from '../core/constraint-evaluator';
import { Constraint } from '../types/constraint';
import { Plan } from '../types/plan';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`断言失败: ${message}`);
}

function constraint(overrides: Partial<Constraint>): Constraint {
  return {
    id: 'c_1',
    tripId: 'trip_T',
    ownerId: 'usr_A',
    type: 'PREFERENCE',
    scope: 'DINING',
    priority: 'SOFT',
    value: { keyword: 'VIETNAMESE' },
    ...overrides,
  };
}

const emptyPlan: Plan = {
  id: 'plan_T',
  tripId: 'trip_T',
  version: 1,
  events: [],
  satisfiedConstraintCount: 0,
  totalConstraintCount: 0,
  conflicts: [],
  updatedAt: '2026-08-28T00:00:00.000Z',
};

assert(
  evaluateConstraintAgainstPlan(constraint({}), emptyPlan) === 'UNKNOWN',
  '空计划不能满足越南菜偏好',
);

const evidencedPlan: Plan = {
  ...emptyPlan,
  events: [{
    id: 'event_dining',
    type: 'DINING',
    title: '越南菜晚餐',
    time: {
      start: '2026-08-28T18:00:00+08:00',
      end: '2026-08-28T19:00:00+08:00',
      timezone: 'Asia/Shanghai',
    },
    location: { id: 'loc_1', name: '天河越南餐厅', district: '天河区', city: '广州市' },
    price: { amount: 70, currency: 'CNY', unit: 'PER_PERSON' },
  }],
  estimatedTotalPrice: { amount: 70, currency: 'CNY', unit: 'PER_PERSON' },
};

assert(
  evaluateConstraintAgainstPlan(constraint({}), evidencedPlan) === 'SATISFIED',
  '真实 DINING event 文本证据匹配越南菜时才满足',
);
assert(
  evaluateConstraintAgainstPlan(constraint({
    type: 'LOCATION',
    scope: 'DINING',
    value: { district: '天河区' },
  }), evidencedPlan) === 'SATISFIED',
  '真实 event.location 匹配天河区时满足地点约束',
);
assert(
  evaluateConstraintAgainstPlan(constraint({
    type: 'BUDGET',
    scope: 'TRIP',
    value: { max: 80, unit: 'PER_PERSON', currency: 'CNY' },
  }), evidencedPlan) === 'SATISFIED',
  '真实人均价格 70 可证明满足人均 80',
);
assert(
  evaluateConstraintAgainstPlan(constraint({
    type: 'LOCATION',
    scope: 'SPORT',
    value: { district: '天河区' },
  }), evidencedPlan) === 'UNKNOWN',
  '没有 SPORT event 时不能借用 DINING 地点证明运动地点约束',
);

console.log('✅ constraint-evaluator.test.ts 全部通过');
