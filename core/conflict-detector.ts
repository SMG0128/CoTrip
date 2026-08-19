// core/conflict-detector.ts
// 冲突检测：检测 HARD 约束之间是否无法同时满足。
// 原则：绝不静默丢弃 HARD 约束，必须显式返回 PlanConflict。

import { Constraint } from '../types/constraint';
import { PlanConflict, PlanConflictType } from '../types/plan';
import { PlanEvent } from '../types/event';

export interface ConflictDetectionInput {
  constraints: Constraint[];
  /** 当前计划事件（用于检测时间窗口与事件时长冲突） */
  events?: PlanEvent[];
}

let conflictSeq = 0;

function nextConflictId(): string {
  conflictSeq += 1;
  return `conflict_${Date.now()}_${conflictSeq}`;
}

/** 解析 ISO 时间戳为毫秒 */
function toMs(iso: string): number {
  return new Date(iso).getTime();
}

/** 计算事件时长（分钟） */
function eventDurationMin(event: PlanEvent): number {
  if (!event.time.end) return 0;
  return (toMs(event.time.end) - toMs(event.time.start)) / 60000;
}

/**
 * 检测约束冲突。
 * 返回冲突列表；无冲突返回空数组。
 */
export function detectConflicts(input: ConflictDetectionInput): PlanConflict[] {
  const conflicts: PlanConflict[] = [];
  const hard = input.constraints.filter((c) => c.priority === 'HARD');

  // ---- 1. AVAILABILITY 内部冲突：availableAfter > availableUntil ----
  const availability = hard.filter((c) => c.type === 'AVAILABILITY');
  for (const c of availability) {
    const after = c.value.availableAfter as string | undefined;
    const until = c.value.availableUntil as string | undefined;
    if (after && until && toMs(after) >= toMs(until)) {
      conflicts.push({
        id: nextConflictId(),
        type: 'TIME_CONFLICT',
        description: `参与者 ${c.ownerId} 的可用时间窗口无效：最早 ${after} 晚于最晚 ${until}。`,
        constraintIds: [c.id],
        suggestions: ['调整可用时间窗口', '重新协商活动时间'],
      });
    }
  }

  // ---- 2. AVAILABILITY 与事件时长冲突 ----
  // 若某事件时长超过可用窗口，则无法安排
  if (input.events && input.events.length > 0) {
    for (const c of availability) {
      const after = c.value.availableAfter as string | undefined;
      const until = c.value.availableUntil as string | undefined;
      if (!after || !until) continue;
      const windowMin = (toMs(until) - toMs(after)) / 60000;
      for (const ev of input.events) {
        const dur = eventDurationMin(ev);
        if (dur > 0 && dur > windowMin) {
          conflicts.push({
            id: nextConflictId(),
            type: 'TIME_CONFLICT',
            description: `事件「${ev.title}」需要 ${dur} 分钟，但参与者 ${c.ownerId} 的可用窗口仅 ${windowMin} 分钟。`,
            constraintIds: [c.id],
            suggestions: ['缩短活动时长', '拆分活动', '调整参与者可用时间'],
          });
        }
      }
    }
  }

  // ---- 3. LOCATION HARD 冲突：同一 scope 出现多个不同 district ----
  const locByScope = new Map<string, Constraint[]>();
  for (const c of hard.filter((x) => x.type === 'LOCATION')) {
    const list = locByScope.get(c.scope) || [];
    list.push(c);
    locByScope.set(c.scope, list);
  }
  for (const [scope, list] of locByScope) {
    const districts = new Set(list.map((c) => c.value.district as string).filter(Boolean));
    if (districts.size > 1) {
      conflicts.push({
        id: nextConflictId(),
        type: 'LOCATION_CONFLICT',
        description: `「${scope}」存在多个互斥的硬性区域要求：${[...districts].join('、')}。`,
        constraintIds: list.map((c) => c.id),
        suggestions: ['协商统一区域', '将部分约束降级为软约束'],
      });
    }
  }

  // ---- 4. BUDGET HARD 冲突：多个硬性预算上限取最小值，若与偏好冲突则提示 ----
  const budgetHard = hard.filter((c) => c.type === 'BUDGET' && typeof c.value.max === 'number');
  if (budgetHard.length > 1) {
    const maxes = budgetHard.map((c) => c.value.max as number);
    const minMax = Math.min(...maxes);
    const stricter = budgetHard.filter((c) => (c.value.max as number) === minMax);
    if (stricter.length > 1) {
      conflicts.push({
        id: nextConflictId(),
        type: 'BUDGET_CONFLICT',
        description: `存在多个硬性预算上限，最严格为 ¥${minMax}，需确认是否可接受。`,
        constraintIds: stricter.map((c) => c.id),
        suggestions: ['确认以最低预算为准', '放宽部分预算约束'],
      });
    }
  }

  return conflicts;
}