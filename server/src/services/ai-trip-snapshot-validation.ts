// AI 行程 snapshot 的共享校验与落库适配。
//
// INITIAL_GENERATION 与 TRIP_UPDATE 使用**同一套** trip snapshot 契约：
// 两者都必须返回完整快照（不是自然语言 patch、不是「变化内容」），
// 因此校验规则与 TripPlan 映射集中在这里，避免两条链路各自漂移。
//
// 产品不变量（Stage 2 锁定，Stage 3 不得放宽）：
//   AI 只描述做什么 / 什么时候 / 地点要求；
//   已验证的真实世界事实（场馆、坐标、价格、评分）只能来自 Provider 层。
//   携带这些字段一律 AI_FORBIDDEN_REAL_WORLD_FACT。

import {
  AITripItem,
  AITripSnapshot,
  INITIAL_GENERATION_MAX_ITEMS,
  INITIAL_GENERATION_SUMMARY_MAX_LENGTH,
} from '../types/ai-initial-generation';
import {
  TripPlan,
  TripPlanEvent,
  TripPlanEventType,
  TripPlanLocationRequirement,
} from '../types/trip-plan';

export interface TripSnapshotValidationResult {
  ok: boolean;
  failurePath?: string;
  failureReasonCode?: string;
}

const EVENT_TYPES: TripPlanEventType[] = [
  'SPORT',
  'DINING',
  'TRANSPORT',
  'ENTERTAINMENT',
  'OTHER',
];

/**
 * AI 禁止提供的字段：这些是必须由 Provider 验证的真实世界事实。
 * 出现即视为违反「AI 不虚构真实世界事实」不变量。
 */
const FORBIDDEN_ITEM_KEYS = ['location', 'price', 'restaurant', 'rating', 'route'];

const ISO_WITH_TIMEZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export const TRIP_PLAN_EVENT_ID_MAX_LENGTH = 64;

function fail(path: string, reasonCode: string): TripSnapshotValidationResult {
  return { ok: false, failurePath: path, failureReasonCode: reasonCode };
}

function isValidIsoWithTimezone(value: unknown): value is string {
  return (
    typeof value === 'string'
    && ISO_WITH_TIMEZONE.test(value)
    && Number.isFinite(Date.parse(value))
  );
}

function validateLocationRequirement(
  value: unknown,
  path: string,
): TripSnapshotValidationResult {
  if (value === undefined) return { ok: true };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail(path, 'LOCATION_REQUIREMENT_OBJECT_REQUIRED');
  }
  const record = value as Record<string, unknown>;
  const allowed = ['city', 'district', 'locationId'];
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      return fail(`${path}.${key}`, 'LOCATION_REQUIREMENT_UNKNOWN_KEY');
    }
    if (record[key] !== undefined && typeof record[key] !== 'string') {
      return fail(`${path}.${key}`, 'LOCATION_REQUIREMENT_NOT_STRING');
    }
  }
  return { ok: true };
}

export interface TripSnapshotValidationOptions {
  /**
   * 是否允许条目携带 id。
   *   INITIAL_GENERATION：false —— 没有既有条目可引用，id 由服务端生成
   *   TRIP_UPDATE：true —— AI 需要用旧 id 表达「这条被保留/修改」
   */
  allowItemIds: boolean;
  /** TRIP_UPDATE 专用：旧计划中的合法 event id，AI 携带的 id 必须命中 */
  previousEventIds?: ReadonlySet<string>;
}

function validateItem(
  value: unknown,
  index: number,
  options: TripSnapshotValidationOptions,
  seenIds: Set<string>,
): TripSnapshotValidationResult {
  const path = `trip.items[${index}]`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail(path, 'ITEM_OBJECT_REQUIRED');
  }
  const item = value as Record<string, unknown>;

  // AI 不得越过 Provider 直接给出已验证的真实世界实体
  for (const forbidden of FORBIDDEN_ITEM_KEYS) {
    if (item[forbidden] !== undefined) {
      return fail(`${path}.${forbidden}`, 'AI_FORBIDDEN_REAL_WORLD_FACT');
    }
  }

  if (item.id !== undefined) {
    if (!options.allowItemIds) {
      return fail(`${path}.id`, 'ITEM_ID_NOT_ALLOWED');
    }
    if (typeof item.id !== 'string' || item.id.trim() === '') {
      return fail(`${path}.id`, 'ITEM_ID_INVALID');
    }
    if (item.id.length > TRIP_PLAN_EVENT_ID_MAX_LENGTH) {
      return fail(`${path}.id`, 'ITEM_ID_TOO_LONG');
    }
    // 保留既有条目时必须引用真实存在的旧 id，禁止凭空捏造 id
    if (options.previousEventIds && !options.previousEventIds.has(item.id)) {
      return fail(`${path}.id`, 'ITEM_ID_UNKNOWN');
    }
    if (seenIds.has(item.id)) {
      return fail(`${path}.id`, 'ITEM_ID_DUPLICATED');
    }
    seenIds.add(item.id);
  }

  if (typeof item.type !== 'string' || !EVENT_TYPES.includes(item.type as TripPlanEventType)) {
    return fail(`${path}.type`, 'ITEM_TYPE_INVALID');
  }
  if (typeof item.title !== 'string' || item.title.trim() === '') {
    return fail(`${path}.title`, 'ITEM_TITLE_REQUIRED');
  }

  const time = item.time;
  if (!time || typeof time !== 'object' || Array.isArray(time)) {
    return fail(`${path}.time`, 'ITEM_TIME_OBJECT_REQUIRED');
  }
  const timeRecord = time as Record<string, unknown>;
  if (!isValidIsoWithTimezone(timeRecord.start)) {
    return fail(`${path}.time.start`, 'ITEM_TIME_START_NOT_ISO');
  }
  if (timeRecord.end !== undefined) {
    if (!isValidIsoWithTimezone(timeRecord.end)) {
      return fail(`${path}.time.end`, 'ITEM_TIME_END_NOT_ISO');
    }
    if (Date.parse(timeRecord.end as string) < Date.parse(timeRecord.start as string)) {
      return fail(`${path}.time.end`, 'ITEM_TIME_RANGE_INVERTED');
    }
  }
  if (typeof timeRecord.timezone !== 'string' || timeRecord.timezone.trim() === '') {
    return fail(`${path}.time.timezone`, 'ITEM_TIME_TIMEZONE_REQUIRED');
  }

  const locationResult = validateLocationRequirement(
    item.locationRequirement,
    `${path}.locationRequirement`,
  );
  if (!locationResult.ok) return locationResult;

  if (item.alternatives !== undefined) {
    if (!Array.isArray(item.alternatives)) {
      return fail(`${path}.alternatives`, 'ITEM_ALTERNATIVES_ARRAY_REQUIRED');
    }
    for (let i = 0; i < item.alternatives.length; i += 1) {
      if (typeof item.alternatives[i] !== 'string') {
        return fail(`${path}.alternatives[${i}]`, 'ITEM_ALTERNATIVE_NOT_STRING');
      }
    }
  }

  return { ok: true };
}

/** 校验 AI 返回的完整行程 snapshot（trip 字段本身） */
export function validateAITripSnapshot(
  trip: unknown,
  options: TripSnapshotValidationOptions,
): TripSnapshotValidationResult {
  if (trip === null || trip === undefined) {
    return fail('trip', 'TRIP_SNAPSHOT_REQUIRED');
  }
  if (typeof trip !== 'object' || Array.isArray(trip)) {
    return fail('trip', 'TRIP_OBJECT_REQUIRED');
  }
  const tripRecord = trip as Record<string, unknown>;

  if (typeof tripRecord.title !== 'string' || tripRecord.title.trim() === '') {
    return fail('trip.title', 'TRIP_TITLE_REQUIRED');
  }
  if (typeof tripRecord.summary !== 'string' || tripRecord.summary.trim() === '') {
    return fail('trip.summary', 'TRIP_SUMMARY_REQUIRED');
  }
  if (!Array.isArray(tripRecord.items)) {
    return fail('trip.items', 'TRIP_ITEMS_ARRAY_REQUIRED');
  }
  // 必须是完整 snapshot：空 itinerary 不是「生成/更新成功」
  if (tripRecord.items.length === 0) {
    return fail('trip.items', 'TRIP_ITEMS_EMPTY');
  }
  if (tripRecord.items.length > INITIAL_GENERATION_MAX_ITEMS) {
    return fail('trip.items', 'TRIP_ITEMS_TOO_MANY');
  }

  const seenIds = new Set<string>();
  for (let i = 0; i < tripRecord.items.length; i += 1) {
    const result = validateItem(tripRecord.items[i], i, options, seenIds);
    if (!result.ok) return result;
  }

  return { ok: true };
}

function toPlanEvent(
  item: AITripItem,
  tripId: string,
  version: number,
  index: number,
): TripPlanEvent {
  const locationRequirement: TripPlanLocationRequirement | undefined = item.locationRequirement
    ? {
        ...(item.locationRequirement.city ? { city: item.locationRequirement.city } : {}),
        ...(item.locationRequirement.district
          ? { district: item.locationRequirement.district }
          : {}),
        ...(item.locationRequirement.locationId
          ? { locationId: item.locationRequirement.locationId }
          : {}),
      }
    : undefined;

  return {
    // 保留 AI 引用的既有 id（条目被保留/修改）；未引用则按版本生成确定性新 id
    id: item.id ?? `event_${tripId}_${version}_${index + 1}`,
    type: item.type,
    title: item.title,
    time: {
      start: item.time.start,
      ...(item.time.end ? { end: item.time.end } : {}),
      timezone: item.time.timezone,
    },
    ...(locationRequirement && Object.keys(locationRequirement).length > 0
      ? { locationRequirement }
      : {}),
    ...(item.alternatives && item.alternatives.length > 0
      ? { alternatives: [...item.alternatives] }
      : {}),
  };
}

/**
 * 校验通过后构造可落库的 TripPlan（完整 snapshot）。
 *
 * 刻意不采用 snapshot.title 覆盖 Trip.title —— 行程标题归用户所有，
 * 沿用 Stage 1「不信任 AI 回显」的原则。
 * 约束满足计数留 0：那是约束账本的确定性结果，不由 AI 决定。
 */
export function buildTripPlanFromSnapshot(
  snapshot: AITripSnapshot,
  tripId: string,
  version: number,
  updatedAt: string,
): TripPlan {
  return {
    id: `plan_${tripId}_v${version}`,
    tripId,
    version,
    events: snapshot.items.map((item, index) => toPlanEvent(item, tripId, version, index)),
    summary: snapshot.summary.slice(0, INITIAL_GENERATION_SUMMARY_MAX_LENGTH),
    satisfiedConstraintCount: 0,
    totalConstraintCount: 0,
    conflicts: [],
    updatedAt,
  };
}
