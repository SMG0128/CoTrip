// Coordinator AI 输出的严格 schema 验证。
// 拒绝：任何 satisfied/resolved 字段、非法 kind/status、结构不完整。

import {
  TripCoordinationProposal,
  TripCoordinationStatus,
  TripCoordinationSuggestionKind,
} from '../types/trip-coordination-proposal';

export interface ProposalValidationResult {
  ok: boolean;
  failurePath?: string;
  failureReasonCode?: string;
}

const VALID_STATUSES: TripCoordinationStatus[] = [
  'READY',
  'NEEDS_RESOLUTION',
  'NEEDS_CONFIRMATION',
];
const VALID_KINDS: TripCoordinationSuggestionKind[] = [
  'ADJUST_TIME',
  'RELAX_SOFT_PREFERENCE',
  'REQUEST_CONFIRMATION',
  'PRIORITIZE_PROXIMITY',
  'OTHER',
];

function fail(path: string, reasonCode: string): ProposalValidationResult {
  return { ok: false, failurePath: path, failureReasonCode: reasonCode };
}

export function validateCoordinationProposal(value: unknown): ProposalValidationResult {
  if (!value || typeof value !== 'object') {
    return fail('$', 'NOT_OBJECT');
  }
  const proposal = value as Record<string, unknown>;

  // AI 不得声称已解决/已满足 —— Server 未确认前这些字段一律拒绝
  if ('resolved' in proposal || 'satisfied' in proposal) {
    return fail('resolved/satisfied', 'AI_FORBIDDEN_SATISFACTION_FIELD');
  }

  if (typeof proposal.summary !== 'string' || proposal.summary.trim() === '') {
    return fail('summary', 'SUMMARY_REQUIRED');
  }
  if (!VALID_STATUSES.includes(proposal.status as TripCoordinationStatus)) {
    return fail('status', 'INVALID_STATUS');
  }
  if (!Array.isArray(proposal.suggestions)) {
    return fail('suggestions', 'SUGGESTIONS_ARRAY_REQUIRED');
  }

  for (let i = 0; i < proposal.suggestions.length; i += 1) {
    const suggestion = proposal.suggestions[i];
    if (!suggestion || typeof suggestion !== 'object') {
      return fail(`suggestions[${i}]`, 'SUGGESTION_NOT_OBJECT');
    }
    const s = suggestion as Record<string, unknown>;
    if ('resolved' in s || 'satisfied' in s) {
      return fail(`suggestions[${i}].resolved/satisfied`, 'AI_FORBIDDEN_SATISFACTION_FIELD');
    }
    if (!VALID_KINDS.includes(s.kind as TripCoordinationSuggestionKind)) {
      return fail(`suggestions[${i}].kind`, 'INVALID_SUGGESTION_KIND');
    }
    if (!Array.isArray(s.affectedConstraintIds)) {
      return fail(`suggestions[${i}].affectedConstraintIds`, 'AFFECTED_IDS_ARRAY_REQUIRED');
    }
    if (typeof s.message !== 'string' || s.message.trim() === '') {
      return fail(`suggestions[${i}].message`, 'SUGGESTION_MESSAGE_REQUIRED');
    }
    if (typeof s.requiresConfirmation !== 'boolean') {
      return fail(`suggestions[${i}].requiresConfirmation`, 'REQUIRES_CONFIRMATION_BOOLEAN');
    }
    if (typeof s.confidence !== 'number' || s.confidence < 0 || s.confidence > 1) {
      return fail(`suggestions[${i}].confidence`, 'CONFIDENCE_RANGE');
    }
  }

  return { ok: true };
}
