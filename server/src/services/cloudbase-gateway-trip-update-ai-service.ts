// CloudBase HTTP Function 网关 adapter（TRIP_UPDATE）。
// 链路：CoTrip Server → CloudBase Gateway /trip-update → 大模型
// 网关返回后 Server 仍执行严格 envelope schema validation（信任边界在 Server）。
//
// 复用 Stage 1 已有的 AI_GATEWAY_URL / AI_GATEWAY_SECRET，不新增任何环境变量。
// 生产端点尚未部署时请求失败 → 上层保持旧版本 currentPlan 不变，评论与评估照常保存。

import { AITripUpdateEnvelope, TripUpdateAIInput } from '../types/ai-trip-update';
import { TripUpdateAIService, TripUpdateAIError } from './trip-update-ai-service';

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

export interface CloudBaseGatewayTripUpdateOptions {
  gatewayUrl: string;
  secret: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

export class CloudBaseGatewayTripUpdateAIService implements TripUpdateAIService {
  readonly source = 'provider' as const;
  private readonly baseUrl: string;
  private readonly secret: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: CloudBaseGatewayTripUpdateOptions) {
    this.baseUrl = options.gatewayUrl.replace(/\/+$/, '');
    this.secret = options.secret;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  async updateTrip(input: TripUpdateAIInput): Promise<AITripUpdateEnvelope> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/trip-update`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tripUpdate: {
            title: input.title,
            tripInput: input.tripInput,
            aiContext: input.aiContext,
            currentPlan: input.currentPlan,
            triggeringComment: input.triggeringComment,
            commentEvaluation: input.commentEvaluation,
            baseVersion: input.baseVersion,
          },
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new TripUpdateAIError('AI_REQUEST_FAILED', 'CloudBase TRIP_UPDATE AI 网关请求失败');
      }
      const payload = (await response.json()) as { envelope?: unknown };
      // 严格 schema validation 由 trip-update-ai-validation 执行；
      // 这里只做最小结构守卫，避免把明显非对象当作 envelope。
      if (!payload.envelope || typeof payload.envelope !== 'object') {
        throw new TripUpdateAIError('AI_INVALID_RESPONSE', 'TRIP_UPDATE AI 响应结构非法');
      }
      return payload.envelope as AITripUpdateEnvelope;
    } catch (error) {
      if (error instanceof TripUpdateAIError) throw error;
      throw new TripUpdateAIError('AI_REQUEST_FAILED', 'CloudBase TRIP_UPDATE AI 网关请求失败');
    } finally {
      clearTimeout(timeout);
    }
  }
}
