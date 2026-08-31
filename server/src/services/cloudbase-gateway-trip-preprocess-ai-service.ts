// CloudBase HTTP Function 网关 adapter（PREPROCESS）。
// 链路：CoTrip Server → CloudBase Gateway /preprocess → 大模型
// 网关返回后 Server 仍执行 PREPROCESS envelope schema validation（信任边界在 Server）。

import {
  AITripPreprocessEnvelope,
  TripPreprocessAIInput,
} from '../types/ai-preprocess';
import {
  TripPreprocessAIService,
  TripPreprocessAIError,
} from './trip-preprocess-ai-service';

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

export interface CloudBaseGatewayPreprocessOptions {
  gatewayUrl: string;
  secret: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

export class CloudBaseGatewayTripPreprocessAIService implements TripPreprocessAIService {
  readonly source = 'provider' as const;
  private readonly baseUrl: string;
  private readonly secret: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: CloudBaseGatewayPreprocessOptions) {
    this.baseUrl = options.gatewayUrl.replace(/\/+$/, '');
    this.secret = options.secret;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  async preprocess(input: TripPreprocessAIInput): Promise<AITripPreprocessEnvelope> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/preprocess`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          preprocess: {
            title: input.title,
            tripInput: input.tripInput,
          },
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new TripPreprocessAIError('AI_REQUEST_FAILED', 'CloudBase PREPROCESS AI 网关请求失败');
      }
      const payload = (await response.json()) as { envelope?: unknown };
      // 返回后由 trip-preprocess-ai-validation 执行严格 schema validation；
      // 这里只做最小结构守卫，避免把明显非对象当作 envelope。
      if (!payload.envelope || typeof payload.envelope !== 'object') {
        throw new TripPreprocessAIError('AI_INVALID_RESPONSE', 'PREPROCESS AI 响应结构非法');
      }
      return payload.envelope as AITripPreprocessEnvelope;
    } catch (error) {
      if (error instanceof TripPreprocessAIError) throw error;
      throw new TripPreprocessAIError('AI_REQUEST_FAILED', 'CloudBase PREPROCESS AI 网关请求失败');
    } finally {
      clearTimeout(timeout);
    }
  }
}
