// TRIP_UPDATE AI 服务抽象。
// 语义约束：产出**修改后的完整** trip snapshot；Envelope 必须 trip !== null 且
// decision.tripChanged === true，通过严格校验 + 版本 CAS 后才可替换 currentPlan。

import { AITripUpdateEnvelope, TripUpdateAIInput } from '../types/ai-trip-update';

export class TripUpdateAIError extends Error {
  constructor(
    public readonly code: 'AI_NOT_CONFIGURED' | 'AI_REQUEST_FAILED' | 'AI_INVALID_RESPONSE',
    message: string,
  ) {
    super(message);
    this.name = 'TripUpdateAIError';
  }
}

export interface TripUpdateAIService {
  readonly source: 'provider' | 'mock' | 'none';
  updateTrip(input: TripUpdateAIInput): Promise<AITripUpdateEnvelope>;
}

/** Provider 未配置时显式失败；上层保持旧版本 currentPlan 不变，绝不伪造更新。 */
export class UnavailableTripUpdateAIService implements TripUpdateAIService {
  readonly source = 'none' as const;

  updateTrip(_input: TripUpdateAIInput): Promise<AITripUpdateEnvelope> {
    return Promise.reject(
      new TripUpdateAIError('AI_NOT_CONFIGURED', 'TRIP_UPDATE AI Provider 尚未配置'),
    );
  }
}
