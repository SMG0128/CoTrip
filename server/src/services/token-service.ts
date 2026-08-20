// server/src/services/token-service.ts
// 应用 token 策略：HMAC 签名的自包含 token，含用户 ID 与过期时间。
// 通过 TokenService 接口抽象，便于未来替换为 JWT 等方案。

import crypto from 'crypto';
import { AppError } from '../types/errors';

export interface TokenPayload {
  userId: string;
  /** 过期时间（毫秒时间戳） */
  exp: number;
}

export interface TokenService {
  sign(userId: string): string;
  verify(token: string): TokenPayload;
}

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

export class HmacTokenService implements TokenService {
  private readonly secret: string;

  constructor(secret: string) {
    this.secret = secret;
  }

  sign(userId: string): string {
    const payload: TokenPayload = {
      userId,
      exp: Date.now() + TOKEN_TTL_MS,
    };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = this.hmac(body);
    return `${body}.${sig}`;
  }

  verify(token: string): TokenPayload {
    const parts = token.split('.');
    if (parts.length !== 2) {
      throw new AppError(401, 'AUTH_INVALID_TOKEN', '无效的登录凭证');
    }
    const [body, sig] = parts;
    const expected = this.hmac(body);
    // 恒定时间比较，防时序攻击
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new AppError(401, 'AUTH_INVALID_TOKEN', '无效的登录凭证');
    }

    let payload: TokenPayload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    } catch {
      throw new AppError(401, 'AUTH_INVALID_TOKEN', '无效的登录凭证');
    }

    if (!payload.userId || typeof payload.exp !== 'number') {
      throw new AppError(401, 'AUTH_INVALID_TOKEN', '无效的登录凭证');
    }
    if (payload.exp < Date.now()) {
      throw new AppError(401, 'AUTH_TOKEN_EXPIRED', '登录已过期，请重新登录');
    }
    return payload;
  }

  private hmac(body: string): string {
    return crypto.createHmac('sha256', this.secret).update(body).digest('base64url');
  }
}