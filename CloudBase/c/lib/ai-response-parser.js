// lib/ai-response-parser.js
// 模型输出解析：模型返回永远视为不可信。
// 只允许纯 JSON，或安全移除单层 markdown fence 后解析。
// 禁止复杂“猜测修复”。无法 parse 由调用方映射为 AI_INVALID_RESPONSE。

/** 安全剥离单层 ```json ... ``` 围栏；不是围栏则原样返回。 */
function stripMarkdownFence(text) {
  const trimmed = String(text).trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fence ? fence[1].trim() : trimmed;
}

/** 提取 AI 文本中的 JSON。解析失败抛错（调用方映射为 502 AI_INVALID_RESPONSE）。 */
function extractJsonContent(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('EMPTY_AI_TEXT');
  }
  const cleaned = stripMarkdownFence(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error('INVALID_AI_JSON');
  }
}

const INTENTS = ['constraint', 'preference', 'chat', 'unclear'];
const TYPES = ['AVAILABILITY', 'LOCATION', 'BUDGET', 'PREFERENCE'];
const SCOPES = ['TRIP', 'SPORT', 'DINING', 'TRANSPORT'];
const PRIORITIES = ['HARD', 'SOFT'];

function valid() {
  return { ok: true };
}

function invalid(failurePath, failureReasonCode) {
  return { ok: false, failurePath, failureReasonCode };
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function rejectUnexpectedKey(value, allowed, path) {
  const key = Object.keys(value).find((candidate) => !allowed.includes(candidate));
  return key === undefined ? null : invalid(path, 'UNEXPECTED_KEY');
}

function validateOptionalString(value, key, path) {
  return value[key] !== undefined && typeof value[key] !== 'string'
    ? invalid(`${path}.${key}`, 'EXPECTED_STRING')
    : null;
}

function isValidIsoDateTime(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function validateConstraintValue(type, value, path) {
  if (!isRecord(value)) return invalid(path, 'EXPECTED_OBJECT');

  if (type === 'AVAILABILITY') {
    const unexpected = rejectUnexpectedKey(value, ['availableAfter', 'availableUntil'], path);
    if (unexpected) return unexpected;
    if (typeof value.availableAfter !== 'string' && typeof value.availableUntil !== 'string') {
      return invalid(path, 'REQUIRED_FIELD');
    }
    for (const key of ['availableAfter', 'availableUntil']) {
      const candidate = value[key];
      if (candidate !== undefined
        && (typeof candidate !== 'string' || !isValidIsoDateTime(candidate))) {
        return invalid(`${path}.${key}`, 'INVALID_DATETIME');
      }
    }
    return valid();
  }

  if (type === 'LOCATION') {
    const keys = ['district', 'city', 'locationId'];
    const unexpected = rejectUnexpectedKey(value, keys, path);
    if (unexpected) return unexpected;
    for (const key of keys) {
      const failure = validateOptionalString(value, key, path);
      if (failure) return failure;
    }
    if (!keys.some((key) => typeof value[key] === 'string' && value[key].trim())) {
      return invalid(path, 'REQUIRED_FIELD');
    }
    return valid();
  }

  if (type === 'BUDGET') {
    const unexpected = rejectUnexpectedKey(
      value,
      ['max', 'min', 'currency', 'unit', 'preference'],
      path,
    );
    if (unexpected) return unexpected;
    if (typeof value.max !== 'number' && typeof value.min !== 'number' && value.preference === undefined) {
      return invalid(path, 'REQUIRED_FIELD');
    }
    for (const key of ['max', 'min']) {
      const candidate = value[key];
      if (candidate !== undefined
        && (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate < 0)) {
        return invalid(`${path}.${key}`, 'INVALID_NUMBER');
      }
    }
    if (typeof value.min === 'number' && typeof value.max === 'number' && value.min > value.max) {
      return invalid(path, 'INVALID_RANGE');
    }
    if (value.currency !== undefined && value.currency !== 'CNY') {
      return invalid(`${path}.currency`, 'INVALID_ENUM');
    }
    if (value.unit !== undefined && !['TOTAL', 'PER_PERSON', 'PER_HOUR'].includes(value.unit)) {
      return invalid(`${path}.unit`, 'INVALID_ENUM');
    }
    if (value.preference !== undefined && !['LOW_COST', 'HIGH_QUALITY'].includes(value.preference)) {
      return invalid(`${path}.preference`, 'INVALID_ENUM');
    }
    return valid();
  }

  const unexpected = rejectUnexpectedKey(value, ['keyword', 'note'], path);
  if (unexpected) return unexpected;
  if (typeof value.keyword !== 'string' && typeof value.note !== 'string') {
    return invalid(path, 'REQUIRED_FIELD');
  }
  for (const key of ['keyword', 'note']) {
    const failure = validateOptionalString(value, key, path);
    if (failure) return failure;
  }
  return valid();
}

function validateConstraint(value, path) {
  if (!isRecord(value)) return invalid(path, 'EXPECTED_OBJECT');
  const unexpected = rejectUnexpectedKey(value, ['type', 'scope', 'priority', 'value'], path);
  if (unexpected) return unexpected;
  if (!TYPES.includes(value.type)) return invalid(`${path}.type`, 'INVALID_ENUM');
  if (!SCOPES.includes(value.scope)) return invalid(`${path}.scope`, 'INVALID_ENUM');
  if (!PRIORITIES.includes(value.priority)) return invalid(`${path}.priority`, 'INVALID_ENUM');
  return validateConstraintValue(value.type, value.value, `${path}.value`);
}

/**
 * 网关侧深层 schema + domain 校验，并只返回字段路径/原因码诊断。
 * 权威校验仍由 CoTrip Server 的 ai-comment-validation 再执行。
 */
function validateGatewayAnalysis(value) {
  if (!isRecord(value)) return invalid('$', 'EXPECTED_OBJECT');
  const unexpected = rejectUnexpectedKey(
    value,
    ['intent', 'constraints', 'confidence', 'requiresConfirmation', 'summary'],
    '$',
  );
  if (unexpected) return unexpected;
  if (!INTENTS.includes(value.intent)) return invalid('intent', 'INVALID_ENUM');
  if (!Array.isArray(value.constraints)) return invalid('constraints', 'EXPECTED_ARRAY');
  if (value.constraints.length > 8) return invalid('constraints', 'TOO_MANY_ITEMS');
  if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence)) {
    return invalid('confidence', 'EXPECTED_NUMBER');
  }
  if (value.confidence < 0 || value.confidence > 1) return invalid('confidence', 'OUT_OF_RANGE');
  if (typeof value.requiresConfirmation !== 'boolean') {
    return invalid('requiresConfirmation', 'EXPECTED_BOOLEAN');
  }
  if (value.summary !== undefined && typeof value.summary !== 'string') {
    return invalid('summary', 'EXPECTED_STRING');
  }
  for (let index = 0; index < value.constraints.length; index += 1) {
    const result = validateConstraint(value.constraints[index], `constraints[${index}]`);
    if (!result.ok) return result;
  }
  if ((value.intent === 'chat' || value.intent === 'unclear') && value.constraints.length > 0) {
    return invalid('constraints', 'INVALID_INTENT_CONSTRAINTS');
  }
  if ((value.intent === 'constraint' || value.intent === 'preference') && value.constraints.length === 0) {
    return invalid('constraints', 'INVALID_INTENT_CONSTRAINTS');
  }
  return valid();
}

function isValidGatewayAnalysis(value) {
  return validateGatewayAnalysis(value).ok;
}

module.exports = {
  stripMarkdownFence,
  extractJsonContent,
  validateGatewayAnalysis,
  isValidGatewayAnalysis,
};
