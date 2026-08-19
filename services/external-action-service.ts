// services/external-action-service.ts
// 第三方跳转服务：统一处理 API / URL / MINIPROGRAM 三种模式。
// 页面只调用 execute(action)，不判断 provider。

import { ExternalAction, ExternalActionResult } from '../types/external-action';

export interface ExternalActionService {
  /** 执行第三方动作，返回执行结果（含降级信息） */
  execute(action: ExternalAction): Promise<ExternalActionResult>;
  /** 根据模式生成可用的动作描述（用于 UI 展示） */
  describe(action: ExternalAction): string;
}