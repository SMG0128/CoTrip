// INITIAL_GENERATION AI 输出的严格 schema 验证 + 落库适配层。
//
// 核心不变量：
//   - requestType 必须是 INITIAL_GENERATION
//   - trip 必须非 null，且是**完整 snapshot**（至少一个条目），不是自然语言 patch
//   - 时间必须是带时区的 ISO-8601（禁止「下午三点」这类自然语言）
//   - AI 绝不产出已验证的真实世界事实：携带 location / price / restaurant 一律拒绝，
//     这些只能来自 Provider 适配层（腾讯地图等）
// 任何违例一律拒绝，不落库。
//
// 适配层（buildTripPlanFromEnvelope）把 AI 线上格式收敛到既有 currentPlan 结构，
// 避免长期维护两套互不兼容的 itinerary schema。

import {
  AIInitialGenerationEnvelope,
  AITripItem,
  INITIAL_GENERATION_MAX_ITEMS,
  INITIAL_GENERATION_SUMMARY_MAX_LENGTH,
} from '../types/ai-initial-generation';
import {
  TripPlan,
  TripPlanEvent,
  TripPlanEventType,
  TripPlanLocationRequirement,
} from '../types/trip-plan';

export interface InitialGenerationValidationResult {
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
const FORBIDDEN_ITEM_KEYS = ['location', 'price', 'restaurant', 'rating'];

const ISO_WITH_TIMEZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function fail(path: string, reasonCode: string): InitialGenerationValidationResult {
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
): InitialGenerationValidationResult {
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

function validateItem(value: unknown, index: number): InitialGenerationValidationResult {
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

export function validateInitialGenerationEnvelope(
  value: unknown,
): InitialGenerationValidationResult {
  if (!value || typeof value !== 'object') {
    return fail('$', 'NOT_OBJECT');
  }
  const envelope = value as Record<string, unknown>;

  if (typeof envelope.schemaVersion !== 'string' || envelope.schemaVersion.trim() === '') {
    return fail('schemaVersion', 'SCHEMA_VERSION_REQUIRED');
  }
  if (envelope.requestType !== 'INITIAL_GENERATION') {
    return fail('requestType', 'INVALID_REQUEST_TYPE');
  }
  if (envelope.status !== 'success') {
    return fail('status', 'INVALID_STATUS');
  }

  const decision = envelope.decision;
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
    return fail('decision', 'DECISION_OBJECT_REQUIRED');
  }
  if ((decision as Record<string, unknown>).tripChanged !== true) {
    return fail('decision.tripChanged', 'DECISION_TRIP_CHANGED_REQUIRED');
  }

  const trip = envelope.trip;
  // 与 PREPROCESS / COMMENT_EVALUATION 相反：本阶段 trip 必须存在
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
  // 首版必须是完整 snapshot：空 itinerary 不是「生成成功」
  if (tripRecord.items.length === 0) {
    return fail('trip.items', 'TRIP_ITEMS_EMPTY');
  }
  if (tripRecord.items.length > INITIAL_GENERATION_MAX_ITEMS) {
    return fail('trip.items', 'TRIP_ITEMS_TOO_MANY');
  }

  for (let i = 0; i < tripRecord.items.length; i += 1) {
    const result = validateItem(tripRecord.items[i], i);
    if (!result.ok) return result;
  }

  return { ok: true };
}

function toPlanEvent(item: AITripItem, tripId: string, index: number): TripPlanEvent {
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
    // 确定性 id：同一 trip 的首版重复生成产出相同 id，便于比对与幂等推理
    id: `event_${tripId}_1_${index + 1}`,
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
 * 验证通过后构造可落库的首版 TripPlan（完整 snapshot）。
 *
 * 注意：刻意不采用 envelope.trip.title 覆盖 Trip.title —— 行程标题归用户所有，
 * 沿用 Stage 1「不信任 AI 回显」的原则（tripInput 由 Server 提供）。
 * 约束满足计数留 0：那是评论约束账本的确定性结果，不由 AI 决定。
 */
export function buildTripPlanFromEnvelope(
  envelope: AIInitialGenerationEnvelope,
  tripId: string,
  updatedAt: string,
): TripPlan {
  return {
    id: `plan_${tripId}_v1`,
    tripId,
    version: 1,
    events: envelope.trip.items.map((item, index) => toPlanEvent(item, tripId, index)),
    summary: envelope.trip.summary.slice(0, INITIAL_GENERATION_SUMMARY_MAX_LENGTH),
    satisfiedConstraintCount: 0,
    totalConstraintCount: 0,
    conflicts: [],
    updatedAt,
  };
}
