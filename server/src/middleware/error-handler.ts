// server/src/middleware/error-handler.ts
// 统一错误处理：返回一致的 JSON 错误结构，绝不泄露堆栈/敏感信息。

import { Request, Response, NextFunction } from 'express';
import { AppError, errorBody } from '../types/errors';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在' } });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.status).json(errorBody(err));
    return;
  }
  // 未知错误：记录日志但不向客户端泄露细节
  console.error('[error]', err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } });
}