// tests/plan-reconciler.test.ts
// 计划协调单元测试：验证时间顺延、版本递增、无重叠。

import { reconcilePlan } from '../core/plan-reconciler';
import { Constraint } from '../types/constraint';
import { Plan, PlanConflict } from '../types/plan';
import { PlanEvent } from '../types/event';

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

function makeBasePlan(): Plan {
  return {
    id: 'plan_test',
    tripId: 'trip_test',
    version: 1,
    events: [
      {
        id: 'ev_sport',
        type: 'SPORT',
        title: '羽毛球',
        time: { start: '2026-08-22T11:00:00+08:00', end: '2026-08-22T13:00:00+08:00', timezone: 'Asia/Shanghai' },
      },
      {
        id: 'ev_transport',
        type: 'TRANSPORT',
        title: '前往越秀',
        time: { start: '2026-08-22T13:00:00+08:00', end: '2026-08-22T13:40:00+08:00', timezone: 'Asia/Shanghai' },
      },
      {
        id: 'ev_dining',
        type: 'DINING',
        title: '越南菜',
        time: { start: '2026-08-22T14:00:00+08:00', timezone: 'Asia/Shanghai' },
      },
    ],
    satisfiedConstraintCount: 0,
    totalConstraintCount: 0,
    conflicts: [],
    updatedAt: '2026-08-22T08:00:00+08:00',
  };
}

// ---- 1. availableAfter 顺延 ----
{
  const constraints: Constraint[] = [
    makeConstraint({
      type: 'AVAILABILITY',
      priority: 'HARD',
      value: { availableAfter: '2026-08-22T11:30:00+08:00' },
    }),
  ];
  const plan = reconcilePlan({ currentPlan: makeBasePlan(), constraints, conflicts: [], tripId: 'trip_test' });

  assert(plan.events[0].time.start === '2026-08-22T11:30:00+08:00', `SPORT 应顺延到 11:30，实际 ${plan.events[0].time.start}`);
  assert(plan.events[0].time.end === '2026-08-22T13:30:00+08:00', `SPORT 结束应顺延到 13:30，实际 ${plan.events[0].time.end}`);
  assert(plan.events[1].time.start === '2026-08-22T13:30:00+08:00', `TRANSPORT 应顺延到 13:30，实际 ${plan.events[1].time.start}`);
  assert(plan.events[2].time.start === '2026-08-22T14:30:00+08:00', `DINING 应顺延到 14:30，实际 ${plan.events[2].time.start}`);
}

// ---- 2. 版本递增 ----
{
  const plan = reconcilePlan({ currentPlan: makeBasePlan(), constraints: [], conflicts: [], tripId: 'trip_test' });
  assert(plan.version === 2, `版本应从 1 递增到 2，实际 ${plan.version}`);
}

// ---- 3. 无重叠（相邻事件首尾相接） ----
{
  const constraints: Constraint[] = [
    makeConstraint({
      type: 'AVAILABILITY',
      priority: 'HARD',
      value: { availableAfter: '2026-08-22T11:30:00+08:00' },
    }),
  ];
  const plan = reconcilePlan({ currentPlan: makeBasePlan(), constraints, conflicts: [], tripId: 'trip_test' });
  const sportEnd = plan.events[0].time.end!;
  const transportStart = plan.events[1].time.start;
  assert(sportEnd === transportStart, `SPORT 结束与 TRANSPORT 开始应相接，实际 ${sportEnd} vs ${transportStart}`);
}

// ---- 4. 首次生成（无 currentPlan） ----
{
  const plan = reconcilePlan({ currentPlan: undefined, constraints: [], conflicts: [], tripId: 'trip_test' });
  assert(plan.version === 1, '首次生成版本应为 1');
  assert(plan.events.length === 0, '无初始计划时事件应为空');
}

// ---- 5. 冲突计数传递 ----
{
  const conflicts: PlanConflict[] = [
    { id: 'conf_1', type: 'TIME_CONFLICT', description: '测试冲突', constraintIds: ['c_1'] },
  ];
  const constraints: Constraint[] = [
    makeConstraint({ id: 'c_1', type: 'AVAILABILITY', priority: 'HARD', value: {} }),
    makeConstraint({ id: 'c_2', type: 'PREFERENCE', priority: 'SOFT', value: {} }),
  ];
  const plan = reconcilePlan({ currentPlan: makeBasePlan(), constraints, conflicts, tripId: 'trip_test' });
  assert(plan.conflicts.length === 1, '冲突应传递到计划');
  assert(plan.satisfiedConstraintCount === 0, `无 evidence 的偏好不能因“无冲突”被满足，实际 ${plan.satisfiedConstraintCount}`);
}

// ---- 6. 空计划：已识别需求也必须是 0 / N ----
{
  const emptyPlan: Plan = {
    ...makeBasePlan(),
    events: [],
  };
  const vietnamese = makeConstraint({
    id: 'c_vietnamese',
    type: 'PREFERENCE',
    scope: 'DINING',
    value: { keyword: 'VIETNAMESE', note: '越南菜' },
  });
  const one = reconcilePlan({ currentPlan: emptyPlan, constraints: [vietnamese], conflicts: [], tripId: 'trip_test' });
  assert(one.totalConstraintCount === 1 && one.satisfiedConstraintCount === 0, '空计划“想吃越南菜”必须 0 / 1');

  const tianhe = makeConstraint({
    id: 'c_tianhe',
    type: 'LOCATION',
    scope: 'SPORT',
    priority: 'HARD',
    value: { district: '天河区' },
  });
  const two = reconcilePlan({ currentPlan: emptyPlan, constraints: [tianhe, vietnamese], conflicts: [], tripId: 'trip_test' });
  assert(two.totalConstraintCount === 2 && two.satisfiedConstraintCount === 0, '空计划两个需求必须 0 / 2');
}

console.log('✅ plan-reconciler.test.ts 全部通过');
