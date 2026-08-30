// 确定性约束评估器（纯逻辑，AI 不参与计算）。
// 输入：Trip 的 ACTIVE constraints + 参与者列表。
// 输出：TripCoordinationState（含 commonAvailability/commonBudget + conflicts）。
//
// 规则：
//   AVAILABILITY(HARD) → 同一 user 的约束先合并为自身窗口（after 取 max、until 取 min），
//                        再跨 user 求交集（after 取 max、until 取 min）；
//                        after>until → NO_COMMON_AVAILABILITY
//                        （跨午夜：同一 user 窗口内 until<after 时 until 视为次日，REVIEW 10）
//   BUDGET(HARD)       → currency/unit 不一致时不合并（BUDGET_UNIT_MISMATCH，不假算）；
//                        兼容单位下 min 取 max、max 取 min；min>max → BUDGET_RANGE_EMPTY
//   LOCATION(HARD)     → 仅 HARD + 有 city 时判不同 city → CITY_MISMATCH
//                        （SOFT location / district/POI 无 Provider evidence 不推断，REVIEW 12）
//   PREFERENCE(SOFT)   → 不同偏好 → PREFERENCE_DIVERGENCE（SOFT_TENSION，非 HARD_CONFLICT）
// 稳定 identity（REVIEW 9）：conflict id 由 tripId+reasonCode+dimension+排序后的
//   constraintIds 生成，相同 authoritative input → 相同 id。

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
  // REVIEW 9：constraintIds 去重排序后参与 id 生成，保证相同 authoritative input → 相同 identity
  const ids = [...new Set(constraintIds)].sort();
  return {
    id: conflictId(input.tripId, reasonCode, dimension, ids.join(',')),
    tripId: input.tripId,
    kind,
    dimension,
    constraintIds: ids,
    participantUserIds: [...new Set(participantUserIds)],
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

    // REVIEW 10：同一 user 的多个 AVAILABILITY 约束先合并为自身窗口，
    // 使「A: 23:00 后 + A: 次日 02:00 前」能被识别为跨午夜窗口，而不是误判为冲突。
    const perUser = new Map<string, { after: number | null; until: number | null }>();
    for (const constraint of hardAvailability) {
      const value = asAvailability(constraint.value);
      const entry = perUser.get(constraint.userId) ?? { after: null, until: null };
      if (value.after !== undefined) {
        const parsed = parseTime(value.after);
        if (parsed !== null) entry.after = entry.after === null ? parsed : Math.max(entry.after, parsed);
      }
      if (value.until !== undefined) {
        const parsed = parseTime(value.until);
        if (parsed !== null) entry.until = entry.until === null ? parsed : Math.min(entry.until, parsed);
      }
      perUser.set(constraint.userId, entry);
    }

    let afterMinutes = 0; // 默认一天开始
    let untilMinutes: number | null = null;
    for (const entry of perUser.values()) {
      let after = entry.after;
      let until = entry.until;
      // 跨午夜：同一 user 窗口 until < after 时视为跨天（如 23:00-02:00 → until 归入次日）
      if (after !== null && until !== null && until < after) {
        until += 1440;
      }
      if (after !== null) afterMinutes = Math.max(afterMinutes, after);
      if (until !== null) untilMinutes = untilMinutes === null ? until : Math.min(untilMinutes, until);
    }
    const hasAfter = [...perUser.values()].some((entry) => entry.after !== null);
    const hasUntil = [...perUser.values()].some((entry) => entry.until !== null);

    // 输出墙钟（跨天窗口归一化到 0-1439）
    const after = hasAfter ? minutesToTime(afterMinutes % 1440) : undefined;
    const until = hasUntil && untilMinutes !== null ? minutesToTime(untilMinutes % 1440) : undefined;

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

    // REVIEW 11：只有兼容单位（currency + unit）才能直接求交集。
    // 单位缺失时按缺省值（CNY / TOTAL）处理；存在不一致 → 不假算，报 BUDGET_UNIT_MISMATCH。
    const currencies = new Set<string>();
    const units = new Set<string>();
    for (const constraint of hardBudget) {
      const value = constraint.value as Record<string, unknown>;
      currencies.add(typeof value.currency === 'string' && value.currency ? value.currency : 'CNY');
      units.add(typeof value.unit === 'string' && value.unit ? value.unit : 'TOTAL');
    }
    if (currencies.size > 1 || units.size > 1) {
      conflicts.push(
        buildConflict(
          input,
          'HARD_CONFLICT',
          'BUDGET',
          'BUDGET_UNIT_MISMATCH',
          hardBudget.map((constraint) => constraint.id),
          [...new Set(hardBudget.map((constraint) => constraint.userId))],
          now,
        ),
      );
      return undefined; // 不产出 commonBudget：无法确定性合并
    }

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
