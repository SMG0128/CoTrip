// server/src/services/cloudbase-gateway-ai-comment-service.ts
// CloudBase HTTP Function 网关 adapter。
// 链路：Mini Program → CoTrip Server → CloudBase Gateway → hunyuan-v3 (hy3)
// 环境配置：AI_PROVIDER=cloudbase_gateway、AI_GATEWAY_URL、AI_GATEWAY_SECRET。
// 网关不是信任边界：返回后 Server 仍执行 schema + domain validation。

import { AICommentAnalysis, AnalyzeCommentInput } from '../types/ai-comment';
import { AICommentService, AICommentServiceError } from './ai-comment-service';
import { validateAICommentAnalysis } from './ai-comment-validation';

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
  /** HTTP Function 基础地址（gatewayUrl 或 gatewayUrl + /analyze 均可） */
  gatewayUrl: string;
  /** 与网关 COTRIP_AI_GATEWAY_SECRET 一致；来自环境变量，不硬编码。 */
  secret: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

/** 从 trip.timeRange 提取日期（YYYY-MM-DD）；结构未知时返回 undefined。 */
function extractTripDate(timeRange: unknown): string | undefined {
  if (!timeRange || typeof timeRange !== 'object') return undefined;
  const value = timeRange as { start?: unknown; date?: unknown };
  if (typeof value.start === 'string' && value.start) return value.start.slice(0, 10);
  if (typeof value.date === 'string' && value.date) return value.date.slice(0, 10);
  return undefined;
}

function extractTimezone(timeRange: unknown): string {
  if (timeRange && typeof timeRange === 'object') {
    const tz = (timeRange as { timezone?: unknown }).timezone;
    if (typeof tz === 'string' && tz) return tz;
  }
  return 'Asia/Shanghai';
}

/**
 * CloudBase HTTP Function 网关 adapter。
 * 失败语义与 OpenAICompatible 一致：请求失败 → AI_REQUEST_FAILED；
 * 响应不合规 → AI_INVALID_RESPONSE。上层 CommentService 保留评论并落 unresolved。
 */
export class CloudBaseGatewayAICommentService implements AICommentService {
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

  async analyzeComment(input: AnalyzeCommentInput): Promise<AICommentAnalysis> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/analyze`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          rawText: input.comment.rawText,
          context: {
            tripId: input.trip.id,
            tripDate: extractTripDate(input.trip.timeRange),
            timezone: extractTimezone(input.trip.timeRange),
          },
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new AICommentServiceError('AI_REQUEST_FAILED', 'CloudBase AI 网关请求失败');
      }
      const payload = (await response.json()) as { analysis?: unknown };
      return validateAICommentAnalysis(payload.analysis);
    } catch (error) {
      if (error instanceof AICommentServiceError) throw error;
      throw new AICommentServiceError('AI_REQUEST_FAILED', 'CloudBase AI 网关请求失败');
    } finally {
      clearTimeout(timeout);
    }
  }
}
