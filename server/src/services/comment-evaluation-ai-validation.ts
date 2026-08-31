// COMMENT_EVALUATION AI 输出的严格 schema 验证。
//
// 核心不变量：
//   - requestType 必须是 COMMENT_EVALUATION
//   - trip 必须是 null（评论判断阶段绝不生成 itinerary）
//   - relevant / usable / updateRequired 必须是真正的 boolean（不接受 'true' / 1 之类）
// 任何违例一律拒绝，不落库、不据此触发生成。

import {
  AICommentEvaluationEnvelope,
  COMMENT_EVALUATION_INTENT_MAX_LENGTH,
  COMMENT_EVALUATION_REASON_MAX_LENGTH,
  CommentEvaluationRecord,
} from '../types/ai-comment-evaluation';
import { AIEnvelopeValidationResult } from '../types/ai-envelope';
import { validateAIUIConfig } from './ai-ui-config-validation';

export type CommentEvaluationValidationResult = AIEnvelopeValidationResult;

function fail(path: string, reasonCode: string): AIEnvelopeValidationResult {
  return { ok: false, failurePath: path, failureReasonCode: reasonCode };
}

export function validateCommentEvaluationEnvelope(
  value: unknown,
): CommentEvaluationValidationResult {
  if (!value || typeof value !== 'object') {
    return fail('$', 'NOT_OBJECT');
  }
  const envelope = value as Record<string, unknown>;

  if (typeof envelope.schemaVersion !== 'string' || envelope.schemaVersion.trim() === '') {
    return fail('schemaVersion', 'SCHEMA_VERSION_REQUIRED');
  }
  if (envelope.requestType !== 'COMMENT_EVALUATION') {
    return fail('requestType', 'INVALID_REQUEST_TYPE');
  }
  if (envelope.status !== 'success') {
    return fail('status', 'INVALID_STATUS');
  }
  // 评论判断阶段最核心不变量：绝不携带 itinerary
  if (envelope.trip !== null) {
    return fail('trip', 'AI_FORBIDDEN_ITINERARY');
  }

  const analysis = envelope.analysis;
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) {
    return fail('analysis', 'ANALYSIS_OBJECT_REQUIRED');
  }
  const analysisRecord = analysis as Record<string, unknown>;
  if (
    typeof analysisRecord.commentIntent !== 'string'
    || analysisRecord.commentIntent.trim() === ''
  ) {
    return fail('analysis.commentIntent', 'ANALYSIS_COMMENT_INTENT_REQUIRED');
  }

  const decision = envelope.decision;
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
    return fail('decision', 'DECISION_OBJECT_REQUIRED');
  }
  const decisionRecord = decision as Record<string, unknown>;
  // 三个字段语义各自独立，必须全部由 AI 明确给出，且必须是严格布尔值
  for (const key of ['relevant', 'usable', 'updateRequired'] as const) {
    if (typeof decisionRecord[key] !== 'boolean') {
      return fail(`decision.${key}`, 'DECISION_FLAG_NOT_BOOLEAN');
    }
  }
  if (typeof decisionRecord.reason !== 'string' || decisionRecord.reason.trim() === '') {
    return fail('decision.reason', 'DECISION_REASON_REQUIRED');
  }

  // 统一 Envelope：评论判断阶段没有 itinerary，ui 只能是安全空值
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
 * 验证通过后构造可持久化的评估记录。
 * 字符串一律截断（有界存储）；绝不写入 AI 原始响应或内部 prompt。
 */
export function buildCommentEvaluationRecord(
  envelope: AICommentEvaluationEnvelope,
  evaluatedAt: string,
): CommentEvaluationRecord {
  return {
    status: 'evaluated',
    schemaVersion: envelope.schemaVersion,
    requestType: 'COMMENT_EVALUATION',
    evaluatedAt,
    commentIntent: envelope.analysis.commentIntent.slice(0, COMMENT_EVALUATION_INTENT_MAX_LENGTH),
    relevant: envelope.decision.relevant,
    usable: envelope.decision.usable,
    updateRequired: envelope.decision.updateRequired,
    reason: envelope.decision.reason.slice(0, COMMENT_EVALUATION_REASON_MAX_LENGTH),
  };
}
