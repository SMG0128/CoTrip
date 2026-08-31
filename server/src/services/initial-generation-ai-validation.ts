// INITIAL_GENERATION AI 输出的严格 schema 验证 + 落库适配层。
//
// 核心不变量：
//   - requestType 必须是 INITIAL_GENERATION
//   - trip 必须非 null，且是**完整 snapshot**（至少一个条目），不是自然语言 patch
//   - 时间必须是带时区的 ISO-8601（禁止「下午三点」这类自然语言）
//   - AI 绝不产出已验证的真实世界事实（location / price / restaurant / rating / route）
//   - 首版没有「旧计划」：条目不得携带 id（由服务端生成），
//     且 ui 的 changed/highlight/removed 必须为空 —— AI 无法预知服务端 id，
//     首版也不存在「被改动」或「被移除」的条目
//   - ui 严格受控：AI 不得输出任何样式
// 任何违例一律拒绝，不落库。
//
// trip snapshot 的校验与 TripPlan 映射由 ai-trip-snapshot-validation 统一提供，
// 与 TRIP_UPDATE 共用同一套契约，避免两条链路漂移。

import { AIEnvelopeValidationResult } from '../types/ai-envelope';
import { AIInitialGenerationEnvelope } from '../types/ai-initial-generation';
import { TripPlan } from '../types/trip-plan';
import { buildTripPlanFromSnapshot, validateAITripSnapshot } from './ai-trip-snapshot-validation';
import { validateAIUIConfig } from './ai-ui-config-validation';

export type InitialGenerationValidationResult = AIEnvelopeValidationResult;

function fail(path: string, reasonCode: string): AIEnvelopeValidationResult {
  return { ok: false, failurePath: path, failureReasonCode: reasonCode };
}

export function validateInitialGenerationEnvelope(value: unknown): AIEnvelopeValidationResult {
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

  // 与 PREPROCESS / COMMENT_EVALUATION 相反：本阶段 trip 必须存在
  const snapshot = validateAITripSnapshot(envelope.trip, { allowItemIds: false });
  if (!snapshot.ok) {
    return {
      ok: false,
      failurePath: snapshot.failurePath,
      failureReasonCode: snapshot.failureReasonCode,
    };
  }

  // 首版：event id 由服务端生成，AI 无从引用；任何 changed/highlight/removed 均非法
  const ui = validateAIUIConfig(envelope.ui, {
    newEventIds: new Set<string>(),
    previousEventIds: new Set<string>(),
    allowRemovals: false,
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

/**
 * 验证通过后构造可落库的首版 TripPlan（完整 snapshot）。
 * 保持 Stage 2 既有 id 规则：plan_<tripId>_v1 / event_<tripId>_1_<n>。
 */
export function buildTripPlanFromEnvelope(
  envelope: AIInitialGenerationEnvelope,
  tripId: string,
  updatedAt: string,
): TripPlan {
  return buildTripPlanFromSnapshot(envelope.trip, tripId, 1, updatedAt);
}
