// server/src/types/errors.ts
// 统一错误类型：所有错误以 { error: { code, message } } 返回。

export type ErrorCode =
  | 'AUTH_MISSING_CODE'
  | 'AUTH_INVALID_CODE'
  | 'AUTH_WECHAT_FAILURE'
  | 'AUTH_INVALID_CREDENTIAL'
  | 'AUTH_UNAUTHORIZED'
  | 'AUTH_INVALID_TOKEN'
  | 'AUTH_TOKEN_EXPIRED'
  | 'USER_PERSISTENCE_FAILURE'
  | 'TRIP_PERSISTENCE_FAILURE'
  | 'TRIP_INVALID_STATUS'
  | 'TRIP_NOT_FOUND'
  | 'TRIP_FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorBody(err: AppError) {
  return { error: { code: err.code, message: err.message } };
}
