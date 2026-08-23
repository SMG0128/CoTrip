// TripService 的真实后端实现。失败会明确抛错，绝不回退 Mock。

import { authConfig } from '../../config/auth';
import { Trip } from '../../types/trip';
import { CreateTripInput, TripJoinPreview, TripService } from '../trip-service';

interface TripResponse {
  trip: Trip;
}

interface TripsResponse {
  trips: Trip[];
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
    return authConfig.baseUrl.replace(/\/$/, '');
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

  async getJoinPreview(_roomCode: string): Promise<TripJoinPreview | null> {
    throw new RealTripServiceError(
      '真实多人加入后端暂不可用',
      'TRIP_JOIN_BACKEND_UNAVAILABLE'
    );
  }

  async joinTrip(_roomCode: string): Promise<Trip> {
    throw new RealTripServiceError(
      '真实多人加入后端暂不可用',
      'TRIP_JOIN_BACKEND_UNAVAILABLE'
    );
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

  private request<T>(
    path: string,
    method: 'GET' | 'POST',
    data?: Record<string, unknown>
  ): Promise<T> {
    if (!authConfig.baseUrl) {
      return Promise.reject(
        new RealTripServiceError('未配置后端地址，无法加载行程', 'TRIP_BACKEND_NOT_CONFIGURED')
      );
    }

    const token = wx.getStorageSync<string>(authConfig.tokenStorageKey);
    if (!token) {
      return Promise.reject(
        new RealTripServiceError('登录状态失效，请重新登录', 'AUTH_UNAUTHORIZED', 401)
      );
    }

    return new Promise((resolve, reject) => {
      wx.request({
        url: `${this.baseUrl}${path}`,
        method,
        data,
        header: { Authorization: `Bearer ${token}` },
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
