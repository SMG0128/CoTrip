// 约束满足度评估：只有当前计划存在可验证 evidence 才能 SATISFIED。
// 「未检测到冲突」与「已满足」是完全不同的语义。

import { Constraint } from '../types/constraint';
import { Plan, PlanConflict } from '../types/plan';
import { PlanEvent } from '../types/event';
import { Price } from '../types/price';

export type ConstraintSatisfaction = 'SATISFIED' | 'UNSATISFIED' | 'UNKNOWN' | 'CONFLICT';

export interface ConstraintEvaluation {
  constraintId: string;
  status: ConstraintSatisfaction;
}

function scopedEvents(constraint: Constraint, plan: Plan): PlanEvent[] {
  if (constraint.scope === 'TRIP' || constraint.scope === 'OTHER') return plan.events;
  return plan.events.filter((event) => event.type === constraint.scope);
}

function normalized(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase() : '';
}

function includesTarget(actual: unknown, target: unknown): boolean {
  const actualText = normalized(actual);
  const targetText = normalized(target);
  if (!actualText || !targetText) return false;
  return actualText.includes(targetText) || targetText.includes(actualText);
}

function evaluateAvailability(constraint: Constraint, events: PlanEvent[]): ConstraintSatisfaction {
  const after = normalized(constraint.value.availableAfter);
  const until = normalized(constraint.value.availableUntil);
  const afterMs = after ? Date.parse(after) : NaN;
  const untilMs = until ? Date.parse(until) : NaN;
  if ((!after && !until) || (after && !Number.isFinite(afterMs)) || (until && !Number.isFinite(untilMs))) {
    return 'UNKNOWN';
  }

  let missingEvidence = false;
  for (const event of events) {
    const startMs = Date.parse(event.time.start);
    if (!Number.isFinite(startMs)) return 'UNKNOWN';
    if (after && startMs < afterMs) return 'UNSATISFIED';
    if (until) {
      if (startMs > untilMs) return 'UNSATISFIED';
      if (!event.time.end) {
        missingEvidence = true;
      } else {
        const endMs = Date.parse(event.time.end);
        if (!Number.isFinite(endMs)) return 'UNKNOWN';
        if (endMs > untilMs) return 'UNSATISFIED';
      }
    }
  }
  return missingEvidence ? 'UNKNOWN' : 'SATISFIED';
}

function evaluateLocation(constraint: Constraint, events: PlanEvent[]): ConstraintSatisfaction {
  const targetDistrict = constraint.value.district;
  const targetCity = constraint.value.city;
  const targetId = constraint.value.locationId;
  if (!targetDistrict && !targetCity && !targetId) return 'UNKNOWN';

  const locations = events.map((event) => event.location).filter(Boolean) as NonNullable<PlanEvent['location']>[];
  if (locations.length === 0) return 'UNKNOWN';

  const matched = locations.some((location) =>
    (!targetDistrict || includesTarget(location.district ?? location.address, targetDistrict))
    && (!targetCity || includesTarget(location.city ?? location.address, targetCity))
    && (!targetId || location.id === targetId)
  );
  if (matched) return 'SATISFIED';
  return locations.length === events.length ? 'UNSATISFIED' : 'UNKNOWN';
}

function priceBounds(price: Price): { min: number; max: number } | null {
  if (typeof price.amount === 'number' && Number.isFinite(price.amount)) {
    return { min: price.amount, max: price.amount };
  }
  const min = typeof price.min === 'number' && Number.isFinite(price.min) ? price.min : undefined;
  const max = typeof price.max === 'number' && Number.isFinite(price.max) ? price.max : undefined;
  if (min === undefined && max === undefined) return null;
  return { min: min ?? 0, max: max ?? Number.POSITIVE_INFINITY };
}

function planPriceEvidence(constraint: Constraint, plan: Plan, events: PlanEvent[]): Price | null {
  const unit = typeof constraint.value.unit === 'string' ? constraint.value.unit : '';
  if (plan.estimatedTotalPrice && (!unit || plan.estimatedTotalPrice.unit === unit)) {
    return plan.estimatedTotalPrice;
  }
  if (events.length === 0 || events.some((event) => !event.price)) return null;
  const prices = events.map((event) => event.price!);
  if (unit && prices.some((price) => price.unit !== unit)) return null;
  const bounds = prices.map(priceBounds);
  if (bounds.some((bound) => !bound)) return null;
  return {
    min: bounds.reduce((sum, bound) => sum + bound!.min, 0),
    max: bounds.reduce((sum, bound) => sum + bound!.max, 0),
    currency: 'CNY',
    unit: prices[0].unit,
  };
}

function evaluateBudget(constraint: Constraint, plan: Plan, events: PlanEvent[]): ConstraintSatisfaction {
  const max = constraint.value.max;
  const min = constraint.value.min;
  if (typeof max !== 'number' && typeof min !== 'number') return 'UNKNOWN';
  const price = planPriceEvidence(constraint, plan, events);
  if (!price) return 'UNKNOWN';
  const bounds = priceBounds(price);
  if (!bounds) return 'UNKNOWN';

  if (typeof max === 'number') {
    if (bounds.min > max) return 'UNSATISFIED';
    if (bounds.max > max) return 'UNKNOWN';
  }
  if (typeof min === 'number') {
    if (bounds.max < min) return 'UNSATISFIED';
    if (bounds.min < min) return 'UNKNOWN';
  }
  return 'SATISFIED';
}

function eventEvidence(event: PlanEvent): string {
  return [
    event.title,
    event.location?.name,
    event.location?.address,
    event.location?.district,
    event.restaurant?.name,
    ...(event.restaurant?.categories ?? []),
  ].filter(Boolean).join(' ').toLocaleLowerCase();
}

function preferenceTerms(constraint: Constraint): string[] {
  const keyword = normalized(constraint.value.keyword);
  const note = normalized(constraint.value.note);
  const mapped: Record<string, string[]> = {
    vietnamese: ['越南', 'vietnam', 'pho', 'phở'],
    badminton: ['羽毛球', 'badminton'],
    metro: ['地铁', 'metro', 'subway'],
  };
  return [...(mapped[keyword] ?? []), keyword, note].filter(Boolean);
}

function evaluatePreference(constraint: Constraint, events: PlanEvent[]): ConstraintSatisfaction {
  const keyword = normalized(constraint.value.keyword);
  if (keyword === 'nearby') return 'UNKNOWN';
  const terms = preferenceTerms(constraint);
  if (terms.length === 0) return 'UNKNOWN';
  const evidence = events.map(eventEvidence).filter(Boolean);
  if (evidence.length === 0) return 'UNKNOWN';
  return evidence.some((text) => terms.some((term) => text.includes(term)))
    ? 'SATISFIED'
    : 'UNSATISFIED';
}

export function evaluateConstraintAgainstPlan(
  constraint: Constraint,
  plan: Plan,
  conflicts: PlanConflict[] = plan.conflicts,
): ConstraintSatisfaction {
  if (conflicts.some((conflict) => conflict.constraintIds.includes(constraint.id))) {
    return 'CONFLICT';
  }
  // 空计划没有任何计划 evidence；无论 Parser/AI 是否识别成功，都不能判为满足。
  if (plan.events.length === 0) return 'UNKNOWN';

  const events = scopedEvents(constraint, plan);
  if (events.length === 0) return 'UNKNOWN';
  switch (constraint.type) {
    case 'AVAILABILITY':
      return evaluateAvailability(constraint, events);
    case 'LOCATION':
      return evaluateLocation(constraint, events);
    case 'BUDGET':
      return evaluateBudget(constraint, plan, events);
    case 'PREFERENCE':
      return evaluatePreference(constraint, events);
    default:
      return 'UNKNOWN';
  }
}

export function evaluateConstraintsAgainstPlan(
  constraints: Constraint[],
  plan: Plan,
  conflicts: PlanConflict[] = plan.conflicts,
): ConstraintEvaluation[] {
  return constraints.map((constraint) => ({
    constraintId: constraint.id,
    status: evaluateConstraintAgainstPlan(constraint, plan, conflicts),
  }));
}

export function countSatisfiedConstraints(
  constraints: Constraint[],
  plan: Plan,
  conflicts: PlanConflict[] = plan.conflicts,
): number {
  return evaluateConstraintsAgainstPlan(constraints, plan, conflicts)
    .filter((result) => result.status === 'SATISFIED').length;
}
