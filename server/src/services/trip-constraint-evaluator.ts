// 确定性约束评估器（纯逻辑，AI 不参与计算）。
// 输入：Trip 的 ACTIVE constraints + 参与者列表。
// 输出：TripCoordinationState（含 commonAvailability/commonBudget + conflicts）。
//
// 规则：
//   AVAILABILITY(HARD) → after 取 max、until 取 min；after>until → NO_COMMON_AVAILABILITY
//   BUDGET(HARD)       → min 取 max、max 取 min；min>max → BUDGET_RANGE_EMPTY
//   LOCATION(HARD)     → 不同 city → CITY_MISMATCH（V1 不推断 district/POI 距离兼容性）
//   PREFERENCE(SOFT)   → 不同偏好 → PREFERENCE_DIVERGENCE（SOFT_TENSION，非 HARD_CONFLICT）

import {
  TripConstraint,
  TripConstraintPriority,
  TripConstraintScope,
  TripConstraintType,
} from '../types/trip-constraint';
import {
  TripConflict,
  TripConflictKind,
  TripConflictReasonCode,
} from '../types/trip-conflict';
import { TripCoordinationState } from '../types/trip-coordination';

export interface EvaluationInput {
  tripId: string;
  constraints: TripConstraint[];
  participantIds: string[];
}

export interface AvailabilityValue {
  after?: string;
  until?: string;
}
export interface BudgetValue {
  min?: number;
  max?: number;
}
export interface LocationValue {
  city?: string;
  district?: string;
  poi?: string;
  locationId?: string;
}
export interface PreferenceValue {
  category?: string;
  tags?: string[];
}

function parseTime(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function minutesToTime(minutes: number): string {
  return formatTime(minutes);
}

function asAvailability(value: Record<string, unknown>): AvailabilityValue {
  return {
    after: typeof value.after === 'string' ? value.after : undefined,
    until: typeof value.until === 'string' ? value.until : undefined,
  };
}

function asBudget(value: Record<string, unknown>): BudgetValue {
  return {
    min: typeof value.min === 'number' ? value.min : undefined,
    max: typeof value.max === 'number' ? value.max : undefined,
  };
}

function asLocation(value: Record<string, unknown>): LocationValue {
  return {
    city: typeof value.city === 'string' ? value.city : undefined,
    district: typeof value.district === 'string' ? value.district : undefined,
    poi: typeof value.poi === 'string' ? value.poi : undefined,
    locationId: typeof value.locationId === 'string' ? value.locationId : undefined,
  };
}

function asPreference(value: Record<string, unknown>): PreferenceValue {
  const tags = Array.isArray(value.tags)
    ? (value.tags as unknown[]).filter((tag): tag is string => typeof tag === 'string')
    : undefined;
  return {
    category: typeof value.category === 'string' ? value.category : undefined,
    tags: tags && tags.length > 0 ? tags : undefined,
  };
}

function conflictId(tripId: string, reasonCode: string, dimension: string, salt: string): string {
  let hash = 0;
  const raw = `${tripId}:${reasonCode}:${dimension}:${salt}`;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return `conflict_${hash.toString(16)}`;
}

function buildConflict(
  input: EvaluationInput,
  kind: TripConflictKind,
  dimension: TripConflict['dimension'],
  reasonCode: TripConflictReasonCode,
  constraintIds: string[],
  participantUserIds: string[],
  now: Date,
): TripConflict {
  return {
    id: conflictId(input.tripId, reasonCode, dimension, constraintIds.join(',').slice(0, 16)),
    tripId: input.tripId,
    kind,
    dimension,
    constraintIds: [...constraintIds],
    participantUserIds: [...participantUserIds],
    reasonCode,
    status: 'OPEN',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export class TripConstraintEvaluator {
  evaluate(input: EvaluationInput): TripCoordinationState {
    const now = new Date();
    const active = input.constraints.filter((constraint) => constraint.status === 'ACTIVE');
    const hard = active.filter((constraint) => constraint.priority === 'HARD');
    const soft = active.filter((constraint) => constraint.priority === 'SOFT');

    const hardConflicts: TripConflict[] = [];
    const softTensions: TripConflict[] = [];

    // ---- AVAILABILITY：HARD 求交集 ----
    const availability = this.evaluateAvailability(input, active, hardConflicts, now);
    // ---- BUDGET：HARD 求交集 ----
    const budget = this.evaluateBudget(input, active, hardConflicts, now);
    // ---- LOCATION：HARD city 冲突 ----
    this.evaluateLocation(input, active, hardConflicts, now);
    // ---- PREFERENCE：SOFT 张力 ----
    this.evaluatePreference(input, active, softTensions, now);

    // ---- Supersession 候选 ----
    const supersessionCandidates = active
      .filter((constraint) => constraint.supersedesConstraintId)
      .map((constraint) => ({
        oldConstraintId: constraint.supersedesConstraintId as string,
        newConstraintId: constraint.id,
        userId: constraint.userId,
        type: constraint.type,
        scope: constraint.scope,
      }));

    return {
      tripId: input.tripId,
      activeConstraintCount: active.length,
      hardConstraintCount: hard.length,
      softConstraintCount: soft.length,
      participantCount: input.participantIds.length,
      ...(availability ? { commonAvailability: availability } : {}),
      ...(budget ? { commonBudget: budget } : {}),
      hardConflicts,
      softTensions,
      supersessionCandidates,
      requiresConfirmation:
        hardConflicts.length > 0
        || softTensions.length > 0
        || supersessionCandidates.length > 0
        || active.some((constraint) => constraint.requiresConfirmation),
      updatedAt: now.toISOString(),
    };
  }

  private evaluateAvailability(
    input: EvaluationInput,
    active: TripConstraint[],
    conflicts: TripConflict[],
    now: Date,
  ): AvailabilityValue | undefined {
    const hardAvailability = active.filter(
      (constraint) =>
        constraint.type === 'AVAILABILITY' && constraint.priority === 'HARD',
    );
    if (hardAvailability.length === 0) return undefined;

    let afterMinutes = 0; // 默认一天开始
    let untilMinutes: number | null = null;
    let hasAfter = false;
    let hasUntil = false;

    for (const constraint of hardAvailability) {
      const value = asAvailability(constraint.value);
      if (value.after !== undefined) {
        const parsed = parseTime(value.after);
        if (parsed !== null) {
          hasAfter = true;
          afterMinutes = Math.max(afterMinutes, parsed);
        }
      }
      if (value.until !== undefined) {
        const parsed = parseTime(value.until);
        if (parsed !== null) {
          hasUntil = true;
          untilMinutes = untilMinutes === null ? parsed : Math.min(untilMinutes, parsed);
        }
      }
    }

    const after = hasAfter ? minutesToTime(afterMinutes) : undefined;
    const until = hasUntil && untilMinutes !== null ? minutesToTime(untilMinutes) : undefined;

    if (hasAfter && hasUntil && afterMinutes > (untilMinutes ?? Number.MAX_SAFE_INTEGER)) {
      conflicts.push(
        buildConflict(
          input,
          'HARD_CONFLICT',
          'AVAILABILITY',
          'NO_COMMON_AVAILABILITY',
          hardAvailability.map((constraint) => constraint.id),
          [...new Set(hardAvailability.map((constraint) => constraint.userId))],
          now,
        ),
      );
      return { after, until };
    }

    return { after, until };
  }

  private evaluateBudget(
    input: EvaluationInput,
    active: TripConstraint[],
    conflicts: TripConflict[],
    now: Date,
  ): BudgetValue | undefined {
    const hardBudget = active.filter(
      (constraint) => constraint.type === 'BUDGET' && constraint.priority === 'HARD',
    );
    if (hardBudget.length === 0) return undefined;

    let min: number | null = null;
    let max: number | null = null;
    let hasMin = false;
    let hasMax = false;

    for (const constraint of hardBudget) {
      const value = asBudget(constraint.value);
      if (value.min !== undefined) {
        hasMin = true;
        min = min === null ? value.min : Math.max(min, value.min);
      }
      if (value.max !== undefined) {
        hasMax = true;
        max = max === null ? value.max : Math.min(max, value.max);
      }
    }

    if (hasMin && hasMax && (min ?? 0) > (max ?? Number.MAX_SAFE_INTEGER)) {
      conflicts.push(
        buildConflict(
          input,
          'HARD_CONFLICT',
          'BUDGET',
          'BUDGET_RANGE_EMPTY',
          hardBudget.map((constraint) => constraint.id),
          [...new Set(hardBudget.map((constraint) => constraint.userId))],
          now,
        ),
      );
      return {
        ...(min !== null ? { min } : {}),
        ...(max !== null ? { max } : {}),
      };
    }

    return {
      ...(min !== null ? { min } : {}),
      ...(max !== null ? { max } : {}),
    };
  }

  private evaluateLocation(
    input: EvaluationInput,
    active: TripConstraint[],
    conflicts: TripConflict[],
    now: Date,
  ): void {
    const hardLocation = active.filter(
      (constraint) => constraint.type === 'LOCATION' && constraint.priority === 'HARD',
    );
    if (hardLocation.length === 0) return;

    const withCity = hardLocation.filter(
      (constraint) => asLocation(constraint.value).city !== undefined,
    );
    if (withCity.length < 2) return;

    const cities = new Set<string>();
    const byCity = new Map<string, TripConstraint[]>();
    for (const constraint of withCity) {
      const city = asLocation(constraint.value).city as string;
      cities.add(city);
      byCity.set(city, [...(byCity.get(city) ?? []), constraint]);
    }

    if (cities.size > 1) {
      // V1：只判 city 级不一致；district/POI 无 Provider evidence 不推断距离兼容性
      const allIds = withCity.map((constraint) => constraint.id);
      conflicts.push(
        buildConflict(
          input,
          'HARD_CONFLICT',
          'LOCATION',
          'CITY_MISMATCH',
          allIds,
          [...new Set(withCity.map((constraint) => constraint.userId))],
          now,
        ),
      );
    }
  }

  private evaluatePreference(
    input: EvaluationInput,
    active: TripConstraint[],
    tensions: TripConflict[],
    now: Date,
  ): void {
    const preferences = active.filter(
      (constraint) =>
        constraint.type === 'PREFERENCE' && constraint.priority === 'SOFT',
    );
    if (preferences.length < 2) return;

    const categories = new Set<string>();
    for (const constraint of preferences) {
      const category = asPreference(constraint.value).category;
      if (category) categories.add(category);
    }
    if (categories.size > 1) {
      const allIds = preferences.map((constraint) => constraint.id);
      tensions.push(
        buildConflict(
          input,
          'SOFT_TENSION',
          'PREFERENCE',
          'PREFERENCE_DIVERGENCE',
          allIds,
          [...new Set(preferences.map((constraint) => constraint.userId))],
          now,
        ),
      );
    }
  }
}
