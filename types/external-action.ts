// types/external-action.ts
// 第三方服务统一通过 ExternalAction 抽象，禁止在 UI 中写死第三方链接。
// 支持三种真实世界连接方式：API / URL / MINIPROGRAM。

export type ExternalActionMode = 'API' | 'URL' | 'MINIPROGRAM';

/** API 模式：调用 Provider 接口获取真实数据 */
export interface ApiExternalAction {
  id: string;
  provider: string;
  mode: 'API';
  /** 动作名，如 search_places / open_location / open_route */
  action: string;
  /** API 请求参数 */
  params?: Record<string, unknown>;
}

/** URL 模式：跳转第三方详情页（大众点评 / 腾讯地图 URI 等） */
export interface UrlExternalAction {
  id: string;
  provider: string;
  mode: 'URL';
  /** 动作名，如 merchant_detail / map_search / map_route */
  action?: string;
  /** 完整目标 URL */
  target: string;
}

/** MINIPROGRAM 模式：跳转第三方小程序 */
export interface MiniProgramExternalAction {
  id: string;
  provider: string;
  mode: 'MINIPROGRAM';
  /** 动作名 */
  action?: string;
  /** 目标小程序 appId */
  appId: string;
  /** 小程序页面路径 */
  path?: string;
  /** 传给小程序的附加数据 */
  extraData?: Record<string, unknown>;
  /** 是否已获得并验证 appId/path；未验证时禁止启用 */
  enabled: boolean;
}

export type ExternalAction =
  | ApiExternalAction
  | UrlExternalAction
  | MiniProgramExternalAction;

/** 执行结果 */
export interface ExternalActionResult {
  ok: boolean;
  /** 实际执行的方式（可能发生降级） */
  executedMode?: ExternalActionMode;
  /** 降级说明 */
  fallbackNote?: string;
  error?: string;
}