// services/trip-plan-diff.ts
// PlanAgent 操作识别（纯函数，无副作用）。
//
// TRIP_UPDATE / INITIAL_GENERATION 以「完整计划快照」表达对行程的修改。
// 本模块把「旧计划 → 新计划」收敛为最小 PlanOperation 集合（ADD / UPDATE / DELETE / MOVE），
// 用于：
//   1) 可观测性 —— PlanAgent: operations=[update, add]（不写完整 LLM 输出）
//   2) 测试 —— 验证 PlanAgent 已承担增删改查职责，而非依赖单句 hardcode
//
// 边界：本模块只描述「计划发生了哪些变化」，不做任何推荐/路线/POI 决策。

import { TripPlan } from '../types/trip-plan';

export type TripPlanOperation =
  | { type: 'add'; eventId: string; title: string; afterEventId?: string }
  | { type: 'update'; eventId: string; title: string; changedFields: string[] }
  | { type: 'delete'; eventId: string; title: string }
  | { type: 'move'; eventId: string; title: string; fromIndex: number; toIndex: number };

export interface TripPlanOperationSummary {
  count: number;
  types: Array<'add' | 'update' | 'delete' | 'move'>;
  operations: TripPlanOperation[];
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * 计算 previous → next 的计划操作集。
 * @param previous 旧计划；null/undefined 视为空计划（用于 INITIAL_GENERATION 全量 ADD 统计）
 */
export function diffTripPlans(previous: TripPlan | null, next: TripPlan): TripPlanOperation[] {
  const prevEvents = previous?.events ?? [];
  const prevById = new Map(prevEvents.map((event) => [event.id, event]));
  const nextById = new Map(next.events.map((event) => [event.id, event]));
  const ops: TripPlanOperation[] = [];

  // DELETE：在旧计划、不在新计划
  for (const event of prevEvents) {
    if (!nextById.has(event.id)) {
      ops.push({ type: 'delete', eventId: event.id, title: event.title });
    }
  }

  // ADD：在新计划、不在旧计划（新增活动的插入位置 = 新计划中前一个兄弟）
  for (let index = 0; index < next.events.length; index += 1) {
    const event = next.events[index];
    if (!prevById.has(event.id)) {
      ops.push({
        type: 'add',
        eventId: event.id,
        title: event.title,
        afterEventId: index > 0 ? next.events[index - 1].id : undefined,
      });
    }
  }

  // UPDATE + MOVE：新旧计划共同存在的活动
  const prevOrder = new Map(prevEvents.map((event, index) => [event.id, index]));
  const nextOrder = new Map(next.events.map((event, index) => [event.id, index]));
  for (const event of next.events) {
    const prev = prevById.get(event.id);
    if (!prev) continue;

    const changedFields: string[] = [];
    if (prev.title !== event.title) changedFields.push('title');
    if (prev.type !== event.type) changedFields.push('type');
    if (!sameJson(prev.time, event.time)) changedFields.push('time');
    if (!sameJson(prev.locationRequirement, event.locationRequirement)) changedFields.push('locationRequirement');
    if (changedFields.length > 0) {
      ops.push({ type: 'update', eventId: event.id, title: event.title, changedFields });
    }

    const fromIndex = prevOrder.get(event.id) ?? -1;
    const toIndex = nextOrder.get(event.id) ?? -1;
    if (fromIndex >= 0 && toIndex >= 0 && fromIndex !== toIndex) {
      ops.push({ type: 'move', eventId: event.id, title: event.title, fromIndex, toIndex });
    }
  }

  return ops;
}

/** 收敛为可观测摘要：操作数量与类型集合 */
export function summarizePlanOperations(operations: TripPlanOperation[]): TripPlanOperationSummary {
  const types = [...new Set(operations.map((operation) => operation.type))];
  return { count: operations.length, types, operations };
}
