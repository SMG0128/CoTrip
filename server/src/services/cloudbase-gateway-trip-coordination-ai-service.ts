// server/src/services/cloudbase-gateway-trip-coordination-ai-service.ts
// CloudBase HTTP Function 网关 adapter（Coordination）。
// 链路：CoTrip Server → CloudBase Gateway /coordinate → hunyuan-v3 (hy3)
// 网关返回后 Server 仍执行 proposal schema validation（信任边界在 Server）。

import { TripCoordinationAIInput } from '../types/trip-coordination-ai-input';
import {
  TripCoordinationAIService,
  TripCoordinationAIError,
} from './trip-coordination-ai-service';
import { TripCoordinationProposal } from '../types/trip-coordination-proposal';

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

export interface CloudBaseGatewayOptions {
  gatewayUrl: string;
  secret: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

export class CloudBaseGatewayTripCoordinationAIService implements TripCoordinationAIService {
  readonly source = 'provider' as const;
  private readonly baseUrl: string;
  private readonly secret: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: CloudBaseGatewayOptions) {
    this.baseUrl = options.gatewayUrl.replace(/\/+$/, '');
    this.secret = options.secret;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  async analyzeCoordination(input: TripCoordinationAIInput): Promise<TripCoordinationProposal> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/coordinate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          coordination: {
            tripId: input.tripId,
            participants: input.participants,
            constraints: input.constraints,
            deterministicEvaluation: input.deterministicEvaluation,
            conflicts: input.conflicts,
          },
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new TripCoordinationAIError('AI_REQUEST_FAILED', 'CloudBase 协调 AI 网关请求失败');
      }
      const payload = (await response.json()) as { proposal?: TripCoordinationProposal };
      // 返回后由 TripCoordinationService 执行严格 schema validation；
      // 这里只做最小结构守卫，避免把明显非对象当作 proposal。
      if (!payload.proposal || typeof payload.proposal !== 'object') {
        throw new TripCoordinationAIError('AI_INVALID_RESPONSE', '协调 AI 响应结构非法');
      }
      return payload.proposal as TripCoordinationProposal;
    } catch (error) {
      if (error instanceof TripCoordinationAIError) throw error;
      throw new TripCoordinationAIError('AI_REQUEST_FAILED', 'CloudBase 协调 AI 网关请求失败');
    } finally {
      clearTimeout(timeout);
    }
  }
}
