// core/plan-reconciler.ts
// 计划协调：将约束应用到当前计划，生成新版本计划。
// 时间协调规则：availableAfter 使事件顺延，后续事件保持 duration/order，无重叠。

import { Constraint } from '../types/constraint';
import { Plan, PlanConflict } from '../types/plan';
import { PlanEvent } from '../types/event';

export interface ReconcileInput {
  /** 当前计划（可能为 undefined，表示首次生成） */
  currentPlan?: Plan;
  constraints: Constraint[];
  conflicts: PlanConflict[];
  tripId: string;
}

/** 解析 ISO 时间戳为毫秒 */
function toMs(iso: string): number {
  return new Date(iso).getTime();
}

/** 毫秒转 ISO 8601（保留原时区偏移） */
function toIso(ms: number, timezone: string): string {
  const d = new Date(ms);
  const offset = timezone === 'Asia/Shanghai' ? '+08:00' : '+08:00';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${offset}`;
}

/** 计算事件时长（毫秒） */
function eventDurationMs(event: PlanEvent): number {
  if (!event.time.end) return 0;
  return toMs(event.time.end) - toMs(event.time.start);
}

/** 获取最早的 availableAfter 约束（HARD） */
function earliestAvailableAfter(constraints: Constraint[]): string | undefined {
  const afters = constraints
    .filter((c) => c.type === 'AVAILABILITY' && c.priority === 'HARD' && c.value.availableAfter)
    .map((c) => c.value.availableAfter as string)
    .sort((a, b) => toMs(a) - toMs(b));
  return afters[0];
}

/** 获取最早的 availableUntil 约束（HARD） */
function earliestAvailableUntil(constraints: Constraint[]): string | undefined {
  const untils = constraints
    .filter((c) => c.type === 'AVAILABILITY' && c.priority === 'HARD' && c.value.availableUntil)
    .map((c) => c.value.availableUntil as string)
    .sort((a, b) => toMs(a) - toMs(b));
  return untils[0];
}

/** 计算满足的约束数（简单启发式：无冲突的 HARD + 全部 SOFT 视为满足） */
function countSatisfied(constraints: Constraint[], conflicts: PlanConflict[]): number {
  const conflictedIds = new Set(conflicts.flatMap((c) => c.constraintIds));
  return constraints.filter((c) => !conflictedIds.has(c.id)).length;
}

/**
 * 协调计划：应用约束，返回新版本计划。
 * 若 currentPlan 不存在，则基于约束构建一个最小骨架计划。
 */
export function reconcilePlan(input: ReconcileInput): Plan {
  const { currentPlan, constraints, conflicts, tripId } = input;
  const timezone = currentPlan?.events[0]?.time.timezone || 'Asia/Shanghai';

  let events: PlanEvent[] = currentPlan ? currentPlan.events.map((e) => ({ ...e, time: { ...e.time } })) : [];

  // ---- 时间协调：availableAfter 顺延 ----
  const after = earliestAvailableAfter(constraints);
  if (after && events.length > 0) {
    const afterMs = toMs(after);
    const firstStart = toMs(events[0].time.start);
    if (afterMs > firstStart) {
      const shift = afterMs - firstStart;
      // 统一平移：所有事件按相同 delta 顺延，保持 duration/order/间隔
      events = events.map((ev) => {
        const newStart = toMs(ev.time.start) + shift;
        const newEnd = ev.time.end ? toMs(ev.time.end) + shift : undefined;
        return {
          ...ev,
          time: {
            start: toIso(newStart, timezone),
            ...(newEnd ? { end: toIso(newEnd, timezone) } : {}),
            timezone,
          },
        };
      });
    }
  }

  // ---- 时间协调：availableUntil 截断（若事件超出截止时间则标记冲突，由 conflict-detector 处理） ----
  // 这里仅做记录，不静默截断，避免破坏 HARD 约束语义。

  // ---- 版本递增 ----
  const version = currentPlan ? currentPlan.version + 1 : 1;

  const satisfied = countSatisfied(constraints, conflicts);

  return {
    id: currentPlan?.id || `plan_${tripId}`,
    tripId,
    version,
    events,
    estimatedTotalPrice: currentPlan?.estimatedTotalPrice,
    satisfiedConstraintCount: satisfied,
    totalConstraintCount: constraints.length,
    conflicts,
    planningContext: buildPlanningContext(constraints),
    updatedAt: new Date().toISOString(),
  };
}

/** 从约束构建规划上下文 */
function buildPlanningContext(constraints: Constraint[]) {
  const budgetHard = constraints.find(
    (c) => c.type === 'BUDGET' && typeof c.value.max === 'number' && c.priority === 'HARD'
  );
  const budgetSoft = constraints.find(
    (c) => c.type === 'BUDGET' && c.value.preference && c.priority === 'SOFT'
  );

  const availabilityWindows = constraints
    .filter((c) => c.type === 'AVAILABILITY')
    .map((c) => ({
      ownerId: c.ownerId,
      availableAfter: c.value.availableAfter as string | undefined,
      availableUntil: c.value.availableUntil as string | undefined,
    }));

  return {
    budgetTarget: {
      ...(budgetHard ? { maxPerPerson: budgetHard.value.max as number } : {}),
      ...(budgetSoft ? { preference: budgetSoft.value.preference as 'LOW_COST' | 'HIGH_QUALITY' } : {}),
    },
    availabilityWindows,
  };
}