// services/external-action-service.ts
// 第三方跳转服务：统一处理 URL / API / MAP / MINIPROGRAM 四种模式。
// 当前仅 Mock，不真正跳转。

import { ExternalAction } from '../types/external-action';

export interface ExternalActionService {
  /** 执行第三方动作（当前 Mock，仅返回成功） */
  execute(action: ExternalAction): Promise<void>;
  /** 根据模式生成可用的动作描述（用于 UI 展示） */
  describe(action: ExternalAction): string;
}