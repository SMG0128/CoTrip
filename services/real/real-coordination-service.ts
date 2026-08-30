// RealCoordinationService：真实后端协调状态。
// 失败明确抛错，绝不回退 Mock；coordinationUnavailable=true 表示 Server 未配置 Coordinator AI。

import { appConfig } from '../../config/auth';
import { CoordinationResult, CoordinationService } from '../coordination-service';

interface BackendCoordinationResponse {
  coordination: CoordinationResult['coordination'];
  proposal?: CoordinationResult['proposal'];
  coordinationUnavailable: boolean;
}

interface BackendError {
  error?: { code?: string; message?: string };
}

export class RealCoordinationServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'RealCoordinationServiceError';
  }
}

export class RealCoordinationService implements CoordinationService {
  private get baseUrl(): string {
    return appConfig.baseUrl.replace(/\/$/, '');
  }

  async getCoordination(tripId: string): Promise<CoordinationResult> {
    const response = await this.request<BackendCoordinationResponse>(
      `/trips/${encodeURIComponent(tripId)}/coordination`,
      'GET'
    );
    return {
      coordination: response.coordination,
      proposal: response.proposal,
      coordinationUnavailable: response.coordinationUnavailable,
    };
  }

  async analyze(tripId: string): Promise<CoordinationResult> {
    const response = await this.request<BackendCoordinationResponse>(
      `/trips/${encodeURIComponent(tripId)}/coordination/analyze`,
      'POST'
    );
    return {
      coordination: response.coordination,
      proposal: response.proposal,
      coordinationUnavailable: response.coordinationUnavailable,
    };
  }

  private request<T>(
    path: string,
    method: 'GET' | 'POST',
    data?: Record<string, unknown>
  ): Promise<T> {
    if (!appConfig.baseUrl) {
      return Promise.reject(
        new RealCoordinationServiceError(
          '未配置后端地址，无法加载协调状态',
          'COORDINATION_BACKEND_NOT_CONFIGURED'
        )
      );
    }

    const token = wx.getStorageSync<string>(appConfig.tokenStorageKey);
    if (!token) {
      return Promise.reject(
        new RealCoordinationServiceError('登录状态失效，请重新登录', 'AUTH_UNAUTHORIZED', 401)
      );
    }
    const header = { Authorization: `Bearer ${token}` };

    return new Promise((resolve, reject) => {
      wx.request({
        url: `${this.baseUrl}${path}`,
        method,
        data,
        header,
        success: (response) => {
          if (response.statusCode >= 200 && response.statusCode < 300 && response.data) {
            resolve(response.data as T);
            return;
          }
          reject(this.toError(response));
        },
        fail: (error) => {
          reject(
            new RealCoordinationServiceError(
              `协调请求失败：${error.errMsg}`,
              'COORDINATION_NETWORK_ERROR'
            )
          );
        },
      });
    });
  }

  private toError(
    response: WechatMiniprogram.RequestSuccessCallbackResult
  ): RealCoordinationServiceError {
    const data = response.data as BackendError | undefined;
    return new RealCoordinationServiceError(
      data?.error?.message || `协调请求失败（${response.statusCode}）`,
      data?.error?.code || 'COORDINATION_REQUEST_FAILED',
      response.statusCode
    );
  }
}
