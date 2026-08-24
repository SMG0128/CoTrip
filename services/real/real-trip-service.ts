// TripService 的真实后端实现。失败会明确抛错，绝不回退 Mock。

import { appConfig } from '../../config/auth';
import { Trip } from '../../types/trip';
import { normalizeRoomCode } from '../../utils/room-code';
import { CreateTripInput, TripJoinPreview, TripService } from '../trip-service';

interface TripResponse {
  trip: Trip;
}

interface TripsResponse {
  trips: Trip[];
}

interface TripJoinPreviewResponse {
  preview: TripJoinPreview;
}

interface BackendError {
  error?: { code?: string; message?: string };
}

export class RealTripServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'RealTripServiceError';
  }
}

export class RealTripService implements TripService {
  private get baseUrl(): string {
    return appConfig.baseUrl.replace(/\/$/, '');
  }

  async createTrip(input: CreateTripInput): Promise<Trip> {
    const response = await this.request<TripResponse>('/trips', 'POST', {
      title: input.title,
      initialBrief: input.initialBrief,
      areaConstraint: input.areaConstraint,
      timeRange: input.timeRange,
    });
    return response.trip;
  }

  async getTrip(tripId: string): Promise<Trip | null> {
    try {
      const response = await this.request<TripResponse>(
        `/trips/${encodeURIComponent(tripId)}`,
        'GET'
      );
      return response.trip;
    } catch (error) {
      if (error instanceof RealTripServiceError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  async getJoinPreview(roomCode: string): Promise<TripJoinPreview | null> {
    const normalized = normalizeRoomCode(roomCode);
    try {
      const response = await this.request<TripJoinPreviewResponse>(
        `/trips/join-preview?roomCode=${encodeURIComponent(normalized)}`,
        'GET',
        undefined,
        false
      );
      // 显式挑选公开字段，避免后端响应中的身份字段越过 preview 边界。
      return {
        roomCode: response.preview.roomCode,
        title: response.preview.title,
        participantCount: response.preview.participantCount,
        status: response.preview.status,
      };
    } catch (error) {
      if (error instanceof RealTripServiceError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  async joinTrip(roomCode: string): Promise<Trip> {
    const response = await this.request<TripResponse>('/trips/join', 'POST', {
      roomCode: normalizeRoomCode(roomCode),
    });
    return response.trip;
  }

  async listActiveTrips(): Promise<Trip[]> {
    const response = await this.request<TripsResponse>('/trips?status=ACTIVE', 'GET');
    return response.trips;
  }

  async listHistoryTrips(): Promise<Trip[]> {
    const response = await this.request<TripsResponse>('/trips?status=COMPLETED', 'GET');
    return response.trips;
  }

  async completeTrip(tripId: string): Promise<Trip> {
    const response = await this.request<TripResponse>(
      `/trips/${encodeURIComponent(tripId)}/complete`,
      'POST'
    );
    return response.trip;
  }

  /** 硬删除：不携带任何请求体，权限完全由后端按 token 身份判定。 */
  async deleteTrip(tripId: string): Promise<void> {
    await this.request<{ ok: boolean }>(`/trips/${encodeURIComponent(tripId)}`, 'DELETE');
  }

  private request<T>(
    path: string,
    method: 'GET' | 'POST' | 'DELETE',
    data?: Record<string, unknown>,
    authRequired = true
  ): Promise<T> {
    if (!appConfig.baseUrl) {
      return Promise.reject(
        new RealTripServiceError('未配置后端地址，无法加载行程', 'TRIP_BACKEND_NOT_CONFIGURED')
      );
    }

    let header: Record<string, string> | undefined;
    if (authRequired) {
      const token = wx.getStorageSync<string>(appConfig.tokenStorageKey);
      if (!token) {
        return Promise.reject(
          new RealTripServiceError('登录状态失效，请重新登录', 'AUTH_UNAUTHORIZED', 401)
        );
      }
      header = { Authorization: `Bearer ${token}` };
    }

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
            new RealTripServiceError(
              `行程请求失败：${error.errMsg}`,
              'TRIP_NETWORK_ERROR'
            )
          );
        },
      });
    });
  }

  private toError(response: WechatMiniprogram.RequestSuccessCallbackResult): RealTripServiceError {
    const data = response.data as BackendError | undefined;
    return new RealTripServiceError(
      data?.error?.message || `行程请求失败（${response.statusCode}）`,
      data?.error?.code || 'TRIP_REQUEST_FAILED',
      response.statusCode
    );
  }
}
