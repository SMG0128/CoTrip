// lib/request-parser.js
// 请求体读取与输入校验：与 HTTP 层解耦，纯函数可测试。

const MAX_BODY_BYTES = 64 * 1024;
const MAX_RAW_TEXT_LENGTH = 1000;

/** 读取原始请求体字符串（上限保护内存；JSON 解析交给 gateway 统一处理）。 */
function readBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        reject(Object.assign(new Error('REQUEST_TOO_LARGE'), { code: 'REQUEST_TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

/** JSON 解析：非法 JSON 返回错误码而不是抛异常。 */
function parseJsonBody(bodyText) {
  if (!bodyText) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(bodyText) };
  } catch {
    return { ok: false, error: 'INVALID_JSON' };
  }
}

/**
 * /analyze 输入校验（网关侧粗校验；权威 domain validation 在 CoTrip Server）。
 * 返回 { ok:true, value:{ rawText, context } } 或 { ok:false, error }。
 */
function validateAnalyzeInput(body, maxRawTextLength = MAX_RAW_TEXT_LENGTH) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'INVALID_INPUT' };
  }
  const rawText = typeof body.rawText === 'string' ? body.rawText.trim() : '';
  if (!rawText) return { ok: false, error: 'RAW_TEXT_REQUIRED' };
  if (rawText.length > maxRawTextLength) return { ok: false, error: 'RAW_TEXT_TOO_LONG' };

  let context;
  if (body.context !== undefined) {
    if (!body.context || typeof body.context !== 'object' || Array.isArray(body.context)) {
      return { ok: false, error: 'INVALID_CONTEXT' };
    }
    context = {
      tripId: typeof body.context.tripId === 'string' ? body.context.tripId : undefined,
      tripDate: typeof body.context.tripDate === 'string' ? body.context.tripDate : undefined,
      timezone: typeof body.context.timezone === 'string' ? body.context.timezone : undefined,
    };
  }
  return { ok: true, value: { rawText, context } };
}

/**
 * /coordinate 输入校验（网关侧粗校验）。
 * 请求体：{ coordination: { tripId, participants, constraints, deterministicEvaluation, conflicts } }
 * 网关只做结构存在性粗校验；权威校验在 CoTrip Server。
 */
function validateCoordinateInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'INVALID_INPUT' };
  }
  const coordination = body.coordination;
  if (!coordination || typeof coordination !== 'object' || Array.isArray(coordination)) {
    return { ok: false, error: 'COORDINATION_REQUIRED' };
  }
  if (typeof coordination.tripId !== 'string' || !coordination.tripId) {
    return { ok: false, error: 'TRIP_ID_REQUIRED' };
  }
  if (
    !Array.isArray(coordination.constraints)
    || !Array.isArray(coordination.conflicts)
    || !coordination.deterministicEvaluation
    || typeof coordination.deterministicEvaluation !== 'object'
  ) {
    return { ok: false, error: 'COORDINATION_SHAPE_INVALID' };
  }
  return { ok: true, value: coordination };
}

module.exports = {
  MAX_BODY_BYTES,
  MAX_RAW_TEXT_LENGTH,
  readBody,
  parseJsonBody,
  validateAnalyzeInput,
  validateCoordinateInput,
};
