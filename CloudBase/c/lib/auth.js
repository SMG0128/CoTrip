// lib/auth.js
// Server-to-server 认证：Bearer <COTRIP_AI_GATEWAY_SECRET>。
// 比较必须使用 crypto.timingSafeEqual，并正确处理长度不同。

const crypto = require('crypto');

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/** 校验 Authorization 头是否等于 Bearer <expectedSecret>。 */
function isAuthorized(authorizationHeader, expectedSecret) {
  if (typeof expectedSecret !== 'string' || expectedSecret.length === 0) return false;
  if (typeof authorizationHeader !== 'string') return false;
  const prefix = 'Bearer ';
  if (!authorizationHeader.startsWith(prefix)) return false;
  return safeEqual(authorizationHeader.slice(prefix.length), expectedSecret);
}

module.exports = { safeEqual, isAuthorized };
