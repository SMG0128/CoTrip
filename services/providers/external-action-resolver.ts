// services/providers/external-action-resolver.ts
// ExternalActionResolver：根据 mode 执行 API / URL / MINIPROGRAM。
// 页面不得判断 provider，只调用 externalActionService.execute(action)。
// 未来可扩展 MAP_NATIVE / DEEPLINK。

import {
  ExternalAction,
  ExternalActionResult,
  ApiExternalAction,
  UrlExternalAction,
  MiniProgramExternalAction,
} from '../../types/external-action';
import { tencentMapUriBuilder } from './tencent-map-uri-builder';

export class ExternalActionResolver {
  /**
   * 执行动作。
   * 返回执行结果；失败时返回 ok=false 并附带降级说明。
   */
  async execute(action: ExternalAction): Promise<ExternalActionResult> {
    switch (action.mode) {
      case 'API':
        return this.executeApi(action);
      case 'URL':
        return this.executeUrl(action);
      case 'MINIPROGRAM':
        return this.executeMiniProgram(action);
      default:
        return { ok: false, error: `未知模式: ${(action as ExternalAction).mode}` };
    }
  }

  /** 根据推荐优先级挑选可执行动作（Native/API → MiniProgram → URL → Fallback） */
  pickBest(actions: ExternalAction[]): ExternalAction | undefined {
    if (actions.length === 0) return undefined;
    // 优先级：API > MINIPROGRAM(enabled) > URL
    const api = actions.find((a) => a.mode === 'API');
    if (api) return api;
    const mp = actions.find((a) => a.mode === 'MINIPROGRAM' && a.enabled);
    if (mp) return mp;
    const url = actions.find((a) => a.mode === 'URL');
    if (url) return url;
    return actions[0];
  }

  // ---- API 模式 ----
  private async executeApi(action: ApiExternalAction): Promise<ExternalActionResult> {
    switch (action.action) {
      case 'open_location': {
        const params = action.params as { latitude?: number; longitude?: number; name?: string } | undefined;
        if (params && typeof params.latitude === 'number' && typeof params.longitude === 'number') {
          return this.openLocation(params.latitude, params.longitude, params.name);
        }
        return { ok: false, error: 'open_location 缺少经纬度参数' };
      }
      case 'open_route': {
        const params = action.params as { to?: { latitude: number; longitude: number } } | undefined;
        if (params?.to) {
          return this.openRoute(params.to);
        }
        return { ok: false, error: 'open_route 缺少终点参数' };
      }
      default:
        return { ok: false, error: `不支持的 API 动作: ${action.action}` };
    }
  }

  // ---- URL 模式 ----
  private async executeUrl(action: UrlExternalAction): Promise<ExternalActionResult> {
    if (!action.target) {
      return { ok: false, error: 'URL 动作缺少 target' };
    }
    return new Promise((resolve) => {
      wx.setClipboardData({
        data: action.target,
        success: () => {
          wx.showModal({
            title: '打开外部链接',
            content: `已复制链接，请在浏览器中打开：\n${action.target}`,
            showCancel: false,
          });
          resolve({ ok: true, executedMode: 'URL' });
        },
        fail: () => resolve({ ok: false, error: '复制链接失败' }),
      });
    });
  }

  // ---- MINIPROGRAM 模式 ----
  private async executeMiniProgram(action: MiniProgramExternalAction): Promise<ExternalActionResult> {
    if (!action.enabled) {
      // 未验证 AppID：自动降级为 URL（若存在）或返回失败
      return {
        ok: false,
        executedMode: 'URL',
        fallbackNote: 'MiniProgram 未配置/未验证，已降级',
        error: 'MiniProgram AppID 未验证，禁止跳转',
      };
    }
    return new Promise((resolve) => {
      wx.navigateToMiniProgram({
        appId: action.appId,
        path: action.path,
        extraData: action.extraData,
        success: () => resolve({ ok: true, executedMode: 'MINIPROGRAM' }),
        fail: (err) => resolve({ ok: false, error: `跳转小程序失败: ${err.errMsg}` }),
      });
    });
  }

  // ---- 原生地图能力 ----
  private openLocation(latitude: number, longitude: number, name?: string): Promise<ExternalActionResult> {
    return new Promise((resolve) => {
      wx.openLocation({
        latitude,
        longitude,
        name,
        scale: 18,
        success: () => resolve({ ok: true, executedMode: 'API' }),
        fail: (err) => resolve({ ok: false, error: `打开地图失败: ${err.errMsg}` }),
      });
    });
  }

  private openRoute(to: { latitude: number; longitude: number }): Promise<ExternalActionResult> {
    // 优先使用腾讯地图 URI 路线规划
    const uri = tencentMapUriBuilder.buildRouteUri({ to });
    return new Promise((resolve) => {
      wx.setClipboardData({
        data: uri,
        success: () => {
          wx.showModal({
            title: '路线规划',
            content: `已生成路线链接，请在浏览器中打开：\n${uri}`,
            showCancel: false,
          });
          resolve({ ok: true, executedMode: 'URL' });
        },
        fail: () => resolve({ ok: false, error: '生成路线失败' }),
      });
    });
  }
}

/** 单例 */
export const externalActionResolver = new ExternalActionResolver();