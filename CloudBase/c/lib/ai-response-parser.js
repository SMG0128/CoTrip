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

/**
 * 网关侧基础 shape 校验（非信任边界）。
 * 权威 schema + domain validation 由 CoTrip Server 的 ai-comment-validation 执行。
 */
function isValidGatewayAnalysis(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value;
  if (typeof v.intent !== 'string') return false;
  if (!['constraint', 'preference', 'chat', 'unclear'].includes(v.intent)) return false;
  if (!Array.isArray(v.constraints)) return false;
  if (typeof v.confidence !== 'number' || !Number.isFinite(v.confidence)) return false;
  if (typeof v.requiresConfirmation !== 'boolean') return false;
  return true;
}

module.exports = { stripMarkdownFence, extractJsonContent, isValidGatewayAnalysis };
