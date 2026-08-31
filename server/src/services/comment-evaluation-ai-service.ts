// COMMENT_EVALUATION AI 服务抽象。
// 语义约束：只判断评论，绝不生成 itinerary；输出 Envelope 必须 trip === null。

import { AICommentEvaluationEnvelope, CommentEvaluationAIInput } from '../types/ai-comment-evaluation';

export class CommentEvaluationAIError extends Error {
  constructor(
    public readonly code: 'AI_NOT_CONFIGURED' | 'AI_REQUEST_FAILED' | 'AI_INVALID_RESPONSE',
    message: string,
  ) {
    super(message);
    this.name = 'CommentEvaluationAIError';
  }
}

export interface CommentEvaluationAIService {
  readonly source: 'provider' | 'mock' | 'none';
  evaluateComment(input: CommentEvaluationAIInput): Promise<AICommentEvaluationEnvelope>;
}

/**
 * Provider 未配置时显式失败。
 * 上层记录 status='unavailable'，评论照常保存、首版行程不生成，
 * 绝不用规则冒充 AI 判断，也绝不因此把评论判成「不相关」。
 */
export class UnavailableCommentEvaluationAIService implements CommentEvaluationAIService {
  readonly source = 'none' as const;

  evaluateComment(_input: CommentEvaluationAIInput): Promise<AICommentEvaluationEnvelope> {
    return Promise.reject(
      new CommentEvaluationAIError('AI_NOT_CONFIGURED', 'COMMENT_EVALUATION AI Provider 尚未配置'),
    );
  }
}
