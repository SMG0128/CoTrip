// TRIP_UPDATE AI 输出的严格 schema 验证 + 落库适配层。
//
// 核心不变量：
//   - requestType 必须是 TRIP_UPDATE
//   - decision.tripChanged 必须是 true（COMMENT_EVALUATION 已负责判断是否需要更新，
//     调用到这里却说「没变」视为响应不符合预期，一律拒绝）
//   - trip 必须非 null，且是**修改后的完整 snapshot**
//   - 条目携带 id 时必须引用旧计划中真实存在的条目，禁止凭空捏造 id
//   - 沿用 Stage 2 真实世界事实边界，禁止为实现更新而放宽
//   - ui 严格受控：AI 不得输出任何样式
// 任何违例一律拒绝，currentPlan 保持旧版本。

import { AIEnvelopeValidationResult } from '../types/ai-envelope';
import { AITripUpdateEnvelope, TripEditScope } from '../types/ai-trip-update';
import { diffTripPlans } from './trip-plan-diff';
import { isDeepStrictEqual } from 'util';
import { TripPlan } from '../types/trip-plan';
import { validateAITripSnapshot, buildTripPlanFromSnapshot } from './ai-trip-snapshot-validation';
import { validateAIUIConfig } from './ai-ui-config-validation';

function fail(path: string, reasonCode: string): AIEnvelopeValidationResult {
  return { ok: false, failurePath: path, failureReasonCode: reasonCode };
}

/**
 * 校验 TRIP_UPDATE envelope。
 * previousPlan 用于两件事：约束 AI 引用的条目 id，以及校验 ui.removedEventIds 语义。
 */
export function validateTripUpdateEnvelope(
  value: unknown,
  previousPlan: TripPlan,
  allowRegenerate = false,
  editScope?: TripEditScope,
): AIEnvelopeValidationResult {
  if (!value || typeof value !== 'object') {
    return fail('$', 'NOT_OBJECT');
  }
  const envelope = value as Record<string, unknown>;

  if (typeof envelope.schemaVersion !== 'string' || envelope.schemaVersion.trim() === '') {
    return fail('schemaVersion', 'SCHEMA_VERSION_REQUIRED');
  }
  if (envelope.requestType !== 'TRIP_UPDATE') {
    return fail('requestType', 'INVALID_REQUEST_TYPE');
  }
  if (envelope.status !== 'success') {
    return fail('status', 'INVALID_STATUS');
  }

  // 统一顶层：analysis 必须存在且为对象（内容由 requestType 自行决定）
  if (
    !envelope.analysis
    || typeof envelope.analysis !== 'object'
    || Array.isArray(envelope.analysis)
  ) {
    return fail('analysis', 'ANALYSIS_OBJECT_REQUIRED');
  }

  const decision = envelope.decision;
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
    return fail('decision', 'DECISION_OBJECT_REQUIRED');
  }
  if ((decision as Record<string, unknown>).tripChanged !== true) {
    return fail('decision.tripChanged', 'DECISION_TRIP_CHANGED_REQUIRED');
  }

  const previousEventIds = new Set(previousPlan.events.map((event) => event.id));
  const snapshot = validateAITripSnapshot(envelope.trip, {
    allowItemIds: true,
    previousEventIds,
  });
  if (!snapshot.ok) {
    return { ok: false, failurePath: snapshot.failurePath, failureReasonCode: snapshot.failureReasonCode };
  }
  const proposal = (envelope as unknown as AITripUpdateEnvelope).trip;
  const retained = new Set(proposal.items.map(item => item.id).filter(Boolean));
  const removals = (envelope as unknown as AITripUpdateEnvelope).ui?.removedEventIds ?? [];
  if (!allowRegenerate) {
    for (const event of previousPlan.events) {
      if (!retained.has(event.id) && !removals.includes(event.id)) {
        return fail('trip.items', 'ACTIVITY_ID_OR_EXPLICIT_REMOVAL_REQUIRED');
      }
    }
  }

  // ui 的 id 必须对齐「校验后真正会落库」的新计划，因此先构造再校验
  const candidate = buildTripPlanFromSnapshot(
    (envelope as unknown as AITripUpdateEnvelope).trip,
    previousPlan.tripId,
    previousPlan.version + 1,
    previousPlan.updatedAt,
  );
  const newEventIds = new Set(candidate.events.map((event) => event.id));
  if (editScope) {
    const applied = buildUpdatedTripPlan(envelope as unknown as AITripUpdateEnvelope, previousPlan, previousPlan.updatedAt);
    if (!previousEventIds.has(editScope.targetActivityId)
      || diffTripPlans(previousPlan, applied).some(op => op.type !== 'update' || op.eventId !== editScope.targetActivityId)
      || applied.events.some(event => event.id !== editScope.targetActivityId
        && !isDeepStrictEqual(event.alternatives, previousPlan.events.find(old => old.id === event.id)?.alternatives))) {
      return fail('trip.items', 'ACTIVITY_EDIT_SCOPE_VIOLATION');
    }
  }

  const ui = validateAIUIConfig(envelope.ui, {
    newEventIds,
    previousEventIds,
    allowRemovals: true,
  });
  if (!ui.ok) {
    return { ok: false, failurePath: ui.failurePath, failureReasonCode: ui.failureReasonCode };
  }

  if (envelope.meta !== undefined && envelope.meta !== null) {
    if (typeof envelope.meta !== 'object' || Array.isArray(envelope.meta)) {
      return fail('meta', 'META_OBJECT_REQUIRED');
    }
  }

  return { ok: true, ui: ui.ui };
}

/** 构造新版本 TripPlan（version = previousVersion + 1） */
export function buildUpdatedTripPlan(
  envelope: AITripUpdateEnvelope,
  previousPlan: TripPlan,
  updatedAt: string,
): TripPlan {
  const candidate = buildTripPlanFromSnapshot(
    envelope.trip,
    previousPlan.tripId,
    previousPlan.version + 1,
    updatedAt,
  );
  // 把快照提案转换为按稳定 ID 的操作。保留未改变活动的服务端地图事实，
  // 变更地点时清除该活动全部地点事实；所有旧交通统一失效并由后处理重算。
  const previousById = new Map(previousPlan.events.map(event => [event.id, event]));
  candidate.events = candidate.events.map(event => {
    const old = previousById.get(event.id);
    if (!old) return event;
    const placeChanged = old.title !== event.title || old.type !== event.type
      || JSON.stringify(old.locationRequirement ?? {}) !== JSON.stringify(event.locationRequirement ?? {});
    const { route: _route, sequenceConstraint: _sequence, ...preserved } = old;
    const merged = { ...preserved, ...event, transportPreference: event.transportPreference ?? old.transportPreference };
    if (placeChanged) {
      delete merged.location;
      delete merged.restaurant;
      delete merged.restaurantCandidates;
      merged.locationStatus = 'unresolved';
    }
    return merged;
  });
  return candidate;
}
