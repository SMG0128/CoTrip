// lib/coordinate-response-parser.js
// /coordinate 的 AI 输出基础 shape 校验（网关侧粗校验）。
// 权威 schema/domain validation 在 CoTrip Server 执行（网关不是信任边界）。
// 关键约束：AI 输出禁止包含 satisfied / resolved 字段（Server 未确认前不允许）。

const VALID_STATUSES = ['READY', 'NEEDS_RESOLUTION', 'NEEDS_CONFIRMATION'];
const VALID_KINDS = [
  'ADJUST_TIME',
  'RELAX_SOFT_PREFERENCE',
  'REQUEST_CONFIRMATION',
  'PRIORITIZE_PROXIMITY',
  'OTHER',
];

function fail(path, reasonCode) {
  return { ok: false, failurePath: path, failureReasonCode: reasonCode };
}

/** 剥离单层 markdown fence 后解析 JSON（复用 ai-response-parser 的解析入口）。 */
function parseProposalJson(text) {
  const { extractJsonContent } = require('./ai-response-parser');
  return extractJsonContent(text);
}

function validateCoordinateProposal(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('$', 'NOT_OBJECT');
  }
  const proposal = value;

  if ('resolved' in proposal || 'satisfied' in proposal) {
    return fail('resolved/satisfied', 'AI_FORBIDDEN_SATISFACTION_FIELD');
  }

  if (typeof proposal.summary !== 'string' || proposal.summary.trim() === '') {
    return fail('summary', 'SUMMARY_REQUIRED');
  }
  if (!VALID_STATUSES.includes(proposal.status)) {
    return fail('status', 'INVALID_STATUS');
  }
  if (!Array.isArray(proposal.suggestions)) {
    return fail('suggestions', 'SUGGESTIONS_ARRAY_REQUIRED');
  }
  for (let i = 0; i < proposal.suggestions.length; i += 1) {
    const s = proposal.suggestions[i];
    if (!s || typeof s !== 'object') {
      return fail(`suggestions[${i}]`, 'SUGGESTION_NOT_OBJECT');
    }
    if ('resolved' in s || 'satisfied' in s) {
      return fail(`suggestions[${i}].resolved/satisfied`, 'AI_FORBIDDEN_SATISFACTION_FIELD');
    }
    if (!VALID_KINDS.includes(s.kind)) {
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

function isValidCoordinateProposal(value) {
  return validateCoordinateProposal(value).ok === true;
}

module.exports = {
  parseProposalJson,
  validateCoordinateProposal,
  isValidCoordinateProposal,
};
