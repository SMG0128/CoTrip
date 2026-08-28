import { AICommentAnalysis, AICommentSource, AnalyzeCommentInput } from '../types/ai-comment';

export class AICommentServiceError extends Error {
  constructor(
    public readonly code: 'AI_NOT_CONFIGURED' | 'AI_REQUEST_FAILED' | 'AI_INVALID_RESPONSE',
    message: string,
  ) {
    super(message);
    this.name = 'AICommentServiceError';
  }
}

export interface AICommentService {
  readonly source: AICommentSource;
  analyzeComment(input: AnalyzeCommentInput): Promise<AICommentAnalysis>;
}

/** Provider 未配置时显式失败；上层会保留评论并落 unresolved，绝不规则假冒 AI。 */
export class UnavailableAICommentService implements AICommentService {
  readonly source = 'none' as const;

  analyzeComment(_input: AnalyzeCommentInput): Promise<AICommentAnalysis> {
    return Promise.reject(
      new AICommentServiceError('AI_NOT_CONFIGURED', '评论 AI Provider 尚未配置'),
    );
  }
}
