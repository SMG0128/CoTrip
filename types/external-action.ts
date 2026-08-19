// types/external-action.ts
// 第三方服务统一通过 ExternalAction 抽象，禁止在 UI 中写死第三方链接。

export type ExternalActionMode = 'URL' | 'API' | 'MAP' | 'MINIPROGRAM';

export interface ExternalAction {
  id: string;
  /** 提供方，如 tencent_map / dianping / amap / ctrip / maoyan */
  provider: string;
  mode: ExternalActionMode;
  /** 动作名，如 open_location / open_route */
  action?: string;
  /** URL 或小程序 appid 等目标 */
  target?: string;
  /** 附加参数 */
  params?: Record<string, unknown>;
}