// tests/conflict-detector.test.ts
// 冲突检测单元测试

import { detectConflicts } from '../core/conflict-detector';
import { Constraint } from '../types/constraint';
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

// ---- 1. availableAfter > availableUntil 冲突 ----
{
  const constraints: Constraint[] = [
    makeConstraint({
      type: 'AVAILABILITY',
      priority: 'HARD',
      value: { availableAfter: '2026-08-22T12:00:00+08:00', availableUntil: '2026-08-22T11:00:00+08:00' },
    }),
  ];
  const conflicts = detectConflicts({ constraints });
  assert(conflicts.length === 1, '无效时间窗口应产生 1 个冲突');
  assert(conflicts[0].type === 'TIME_CONFLICT', '应为 TIME_CONFLICT');
}

// ---- 2. 事件时长超过可用窗口 ----
{
  const constraints: Constraint[] = [
    makeConstraint({
      type: 'AVAILABILITY',
      priority: 'HARD',
      value: { availableAfter: '2026-08-22T11:30:00+08:00', availableUntil: '2026-08-22T12:00:00+08:00' },
    }),
  ];
  const events: PlanEvent[] = [
    {
      id: 'ev1',
      type: 'SPORT',
      title: '羽毛球',
      time: { start: '2026-08-22T11:30:00+08:00', end: '2026-08-22T13:30:00+08:00', timezone: 'Asia/Shanghai' },
    },
  ];
  const conflicts = detectConflicts({ constraints, events });
  assert(conflicts.length === 1, '120 分钟事件超出 30 分钟窗口应产生冲突');
  assert(conflicts[0].type === 'TIME_CONFLICT', '应为 TIME_CONFLICT');
}

// ---- 3. 同一 scope 多个互斥 HARD 区域 ----
{
  const constraints: Constraint[] = [
    makeConstraint({ type: 'LOCATION', scope: 'SPORT', priority: 'HARD', value: { district: '天河区' } }),
    makeConstraint({ type: 'LOCATION', scope: 'SPORT', priority: 'HARD', value: { district: '越秀区' } }),
  ];
  const conflicts = detectConflicts({ constraints });
  assert(conflicts.length === 1, '互斥区域应产生 1 个冲突');
  assert(conflicts[0].type === 'LOCATION_CONFLICT', '应为 LOCATION_CONFLICT');
}

// ---- 4. 无冲突场景 ----
{
  const constraints: Constraint[] = [
    makeConstraint({ type: 'AVAILABILITY', priority: 'HARD', value: { availableAfter: '2026-08-22T10:00:00+08:00' } }),
    makeConstraint({ type: 'LOCATION', scope: 'SPORT', priority: 'HARD', value: { district: '天河区' } }),
    makeConstraint({ type: 'BUDGET', priority: 'SOFT', value: { preference: 'LOW_COST' } }),
  ];
  const conflicts = detectConflicts({ constraints });
  assert(conflicts.length === 0, '无冲突场景不应产生冲突');
}

// ---- 5. SOFT 约束不触发冲突 ----
{
  const constraints: Constraint[] = [
    makeConstraint({ type: 'LOCATION', scope: 'SPORT', priority: 'SOFT', value: { district: '天河区' } }),
    makeConstraint({ type: 'LOCATION', scope: 'SPORT', priority: 'SOFT', value: { district: '越秀区' } }),
  ];
  const conflicts = detectConflicts({ constraints });
  assert(conflicts.length === 0, 'SOFT 区域偏好不应触发冲突');
}

console.log('✅ conflict-detector.test.ts 全部通过');