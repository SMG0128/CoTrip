// Coordinator AI 服务抽象：独立于单条 Comment AI 接口。
// AI 只能解释/排序/提出协调建议；不得设置 satisfied、不得修改 Constraint Ledger。

import {
  TripCoordinationAIInput,
} from '../types/trip-coordination-ai-input';
import { TripCoordinationProposal } from '../types/trip-coordination-proposal';

export class TripCoordinationAIError extends Error {
  constructor(
    public readonly code: 'AI_NOT_CONFIGURED' | 'AI_REQUEST_FAILED' | 'AI_INVALID_RESPONSE',
    message: string,
  ) {
    super(message);
    this.name = 'TripCoordinationAIError';
  }
}

export interface TripCoordinationAIService {
  readonly source: 'provider' | 'mock' | 'none';
  analyzeCoordination(input: TripCoordinationAIInput): Promise<TripCoordinationProposal>;
}

/** Provider 未配置时显式失败；上层保留 deterministic state，绝不伪造 proposal。 */
export class UnavailableTripCoordinationAIService implements TripCoordinationAIService {
  readonly source = 'none' as const;

  analyzeCoordination(_input: TripCoordinationAIInput): Promise<TripCoordinationProposal> {
    return Promise.reject(
      new TripCoordinationAIError('AI_NOT_CONFIGURED', 'Coordinator AI Provider 尚未配置'),
    );
  }
}
