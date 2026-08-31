// CloudBase HTTP Function 网关 adapter（COMMENT_EVALUATION）。
// 链路：CoTrip Server → CloudBase Gateway /comment-evaluation → 大模型
// 网关返回后 Server 仍执行严格 envelope schema validation（信任边界在 Server）。
//
// 复用 Stage 1 已有的 AI_GATEWAY_URL / AI_GATEWAY_SECRET，不新增任何 secret。
// 生产端点尚未部署时请求失败 → 上层记录 status='unavailable'，评论照常保存。

import {
  AICommentEvaluationEnvelope,
  CommentEvaluationAIInput,
} from '../types/ai-comment-evaluation';
import {
  CommentEvaluationAIService,
  CommentEvaluationAIError,
} from './comment-evaluation-ai-service';

interface HttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

type FetchLike = (
  url: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<HttpResponse>;

export interface CloudBaseGatewayCommentEvaluationOptions {
  gatewayUrl: string;
  secret: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

export class CloudBaseGatewayCommentEvaluationAIService implements CommentEvaluationAIService {
  readonly source = 'provider' as const;
  private readonly baseUrl: string;
  private readonly secret: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: CloudBaseGatewayCommentEvaluationOptions) {
    this.baseUrl = options.gatewayUrl.replace(/\/+$/, '');
    this.secret = options.secret;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  async evaluateComment(input: CommentEvaluationAIInput): Promise<AICommentEvaluationEnvelope> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/comment-evaluation`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          commentEvaluation: {
            title: input.title,
            tripInput: input.tripInput,
            aiContext: input.aiContext,
            comment: input.comment,
          },
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new CommentEvaluationAIError(
          'AI_REQUEST_FAILED',
          'CloudBase COMMENT_EVALUATION AI 网关请求失败',
        );
      }
      const payload = (await response.json()) as { envelope?: unknown };
      // 严格 schema validation 由 comment-evaluation-ai-validation 执行；
      // 这里只做最小结构守卫，避免把明显非对象当作 envelope。
      if (!payload.envelope || typeof payload.envelope !== 'object') {
        throw new CommentEvaluationAIError(
          'AI_INVALID_RESPONSE',
          'COMMENT_EVALUATION AI 响应结构非法',
        );
      }
      return payload.envelope as AICommentEvaluationEnvelope;
    } catch (error) {
      if (error instanceof CommentEvaluationAIError) throw error;
      throw new CommentEvaluationAIError(
        'AI_REQUEST_FAILED',
        'CloudBase COMMENT_EVALUATION AI 网关请求失败',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
