// INITIAL_GENERATION AI 服务抽象。
// 语义约束：产出首版完整行程 snapshot；Envelope 必须 trip !== null 且通过严格校验后才可落库。

import { AIInitialGenerationEnvelope, InitialGenerationAIInput } from '../types/ai-initial-generation';

export class InitialGenerationAIError extends Error {
  constructor(
    public readonly code: 'AI_NOT_CONFIGURED' | 'AI_REQUEST_FAILED' | 'AI_INVALID_RESPONSE',
    message: string,
  ) {
    super(message);
    this.name = 'InitialGenerationAIError';
  }
}

export interface InitialGenerationAIService {
  readonly source: 'provider' | 'mock' | 'none';
  generateInitialTrip(input: InitialGenerationAIInput): Promise<AIInitialGenerationEnvelope>;
}

/** Provider 未配置时显式失败；上层保持 currentPlan 缺省，绝不伪造首版行程。 */
export class UnavailableInitialGenerationAIService implements InitialGenerationAIService {
  readonly source = 'none' as const;

  generateInitialTrip(_input: InitialGenerationAIInput): Promise<AIInitialGenerationEnvelope> {
    return Promise.reject(
      new InitialGenerationAIError('AI_NOT_CONFIGURED', 'INITIAL_GENERATION AI Provider 尚未配置'),
    );
  }
}
