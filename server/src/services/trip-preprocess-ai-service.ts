// Trip PREPROCESS AI 服务抽象：创建行程时的第一次 AI 调用。
// 语义约束：只做意图/约束预处理（PREPROCESS），绝不生成 itinerary；
// 输出必须是 trip === null 且 decision.canGenerateTrip === false 的 Envelope。

import { TripPreprocessAIInput } from '../types/ai-preprocess';
import { AITripPreprocessEnvelope } from '../types/ai-preprocess';

export class TripPreprocessAIError extends Error {
  constructor(
    public readonly code: 'AI_NOT_CONFIGURED' | 'AI_REQUEST_FAILED' | 'AI_INVALID_RESPONSE',
    message: string,
  ) {
    super(message);
    this.name = 'TripPreprocessAIError';
  }
}

export interface TripPreprocessAIService {
  readonly source: 'provider' | 'mock' | 'none';
  preprocess(input: TripPreprocessAIInput): Promise<AITripPreprocessEnvelope>;
}

/** Provider 未配置时显式失败；上层保留确定性创建流程，绝不伪造 AI Context。 */
export class UnavailableTripPreprocessAIService implements TripPreprocessAIService {
  readonly source = 'none' as const;

  preprocess(_input: TripPreprocessAIInput): Promise<AITripPreprocessEnvelope> {
    return Promise.reject(
      new TripPreprocessAIError('AI_NOT_CONFIGURED', 'PREPROCESS AI Provider 尚未配置'),
    );
  }
}
