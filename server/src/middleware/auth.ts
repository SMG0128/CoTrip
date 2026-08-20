// server/src/middleware/auth.ts
// 认证中间件：解析 Authorization: Bearer <token>，校验后注入 userId。

import { Request, Response, NextFunction } from 'express';
import { TokenService } from '../services/token-service';
import { AppError } from '../types/errors';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function requireAuth(tokens: TokenService) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      next(new AppError(401, 'AUTH_UNAUTHORIZED', '缺少登录凭证'));
      return;
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      next(new AppError(401, 'AUTH_UNAUTHORIZED', '缺少登录凭证'));
      return;
    }
    try {
      const payload = tokens.verify(token);
      req.userId = payload.userId;
      next();
    } catch (err) {
      next(err);
    }
  };
}