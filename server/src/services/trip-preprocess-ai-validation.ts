// PREPROCESS AI 输出的严格 schema 验证。
// 核心不变量：requestType 必须是 PREPROCESS、trip 必须是 null（禁止任何 itinerary）、
// decision.canGenerateTrip 必须是 false。任何违例一律拒绝，不落库。

import { AITripPreprocessEnvelope, TripAIContext, TripPreprocessTripInput } from '../types/ai-preprocess';

export interface PreprocessEnvelopeValidationResult {
  ok: boolean;
  failurePath?: string;
  failureReasonCode?: string;
}

function fail(path: string, reasonCode: string): PreprocessEnvelopeValidationResult {
  return { ok: false, failurePath: path, failureReasonCode: reasonCode };
}

export function validatePreprocessEnvelope(value: unknown): PreprocessEnvelopeValidationResult {
  if (!value || typeof value !== 'object') {
    return fail('$', 'NOT_OBJECT');
  }
  const envelope = value as Record<string, unknown>;

  if (typeof envelope.schemaVersion !== 'string' || envelope.schemaVersion.trim() === '') {
    return fail('schemaVersion', 'SCHEMA_VERSION_REQUIRED');
  }
  if (envelope.requestType !== 'PREPROCESS') {
    return fail('requestType', 'INVALID_REQUEST_TYPE');
  }
  if (envelope.status !== 'success') {
    return fail('status', 'INVALID_STATUS');
  }
  // PREPROCESS 阶段最核心不变量：绝不携带 itinerary
  if (envelope.trip !== null) {
    return fail('trip', 'AI_FORBIDDEN_ITINERARY');
  }
  if (
    !envelope.decision ||
    typeof envelope.decision !== 'object' ||
    (envelope.decision as Record<string, unknown>).canGenerateTrip !== false
  ) {
    return fail('decision.canGenerateTrip', 'AI_FORBIDDEN_GENERATION_FLAG');
  }

  const analysis = envelope.analysis;
  if (!analysis || typeof analysis !== 'object') {
    return fail('analysis', 'ANALYSIS_OBJECT_REQUIRED');
  }
  const analysisRecord = analysis as Record<string, unknown>;
  if (typeof analysisRecord.intent !== 'string' || analysisRecord.intent.trim() === '') {
    return fail('analysis.intent', 'ANALYSIS_INTENT_REQUIRED');
  }
  if (
    !analysisRecord.constraints ||
    typeof analysisRecord.constraints !== 'object' ||
    Array.isArray(analysisRecord.constraints)
  ) {
    return fail('analysis.constraints', 'ANALYSIS_CONSTRAINTS_OBJECT_REQUIRED');
  }
  if (!Array.isArray(analysisRecord.activities)) {
    return fail('analysis.activities', 'ANALYSIS_ACTIVITIES_ARRAY_REQUIRED');
  }
  if (!Array.isArray(analysisRecord.missingInformation)) {
    return fail('analysis.missingInformation', 'ANALYSIS_MISSING_INFO_ARRAY_REQUIRED');
  }
  for (let i = 0; i < analysisRecord.activities.length; i += 1) {
    if (typeof analysisRecord.activities[i] !== 'string') {
      return fail(`analysis.activities[${i}]`, 'ANALYSIS_ACTIVITY_NOT_STRING');
    }
  }
  for (let i = 0; i < analysisRecord.missingInformation.length; i += 1) {
    if (typeof analysisRecord.missingInformation[i] !== 'string') {
      return fail(`analysis.missingInformation[${i}]`, 'ANALYSIS_MISSING_INFO_NOT_STRING');
    }
  }

  return { ok: true };
}

/** 验证通过后构造可持久化的 AI Context；tripInput 由 Server 侧原始请求提供，不信任 AI 回显。 */
export function buildTripAIContext(
  envelope: AITripPreprocessEnvelope,
  tripInput: TripPreprocessTripInput,
  createdAt: string,
): TripAIContext {
  return {
    schemaVersion: envelope.schemaVersion,
    requestType: 'PREPROCESS',
    status: 'success',
    createdAt,
    analysis: {
      title: envelope.analysis.title,
      intent: envelope.analysis.intent,
      constraints: envelope.analysis.constraints,
      activities: envelope.analysis.activities,
      missingInformation: envelope.analysis.missingInformation,
    },
    decision: { canGenerateTrip: false },
    trip: null,
    tripInput,
  };
}
