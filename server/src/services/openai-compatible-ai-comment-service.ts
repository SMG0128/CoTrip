import { AICommentAnalysis, AnalyzeCommentInput } from '../types/ai-comment';
import { AICommentService, AICommentServiceError } from './ai-comment-service';
import { validateAICommentAnalysis } from './ai-comment-validation';

interface HttpResponse {
  ok: boolean;
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

interface OpenAICompatibleOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

/** OpenAI-compatible Chat Completions adapter；业务层只依赖 AICommentService。 */
export class OpenAICompatibleAICommentService implements AICommentService {
  readonly source = 'provider' as const;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: OpenAICompatibleOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  async analyzeComment(input: AnalyzeCommentInput): Promise<AICommentAnalysis> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: [
                '你是 CoTrip 评论分析器，只输出 JSON。',
                'intent 只能是 constraint/preference/chat/unclear。',
                'constraints 每项只允许 type=AVAILABILITY/LOCATION/BUDGET/PREFERENCE，',
                'scope=TRIP/SPORT/DINING/TRANSPORT，priority=HARD/SOFT。',
                '无法可靠结构化时 intent=unclear、constraints=[]、requiresConfirmation=true。',
              ].join(''),
            },
            { role: 'user', content: JSON.stringify(input) },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new AICommentServiceError('AI_REQUEST_FAILED', 'AI Provider 请求失败');
      }
      const payload = await response.json();
      const content = extractContent(payload);
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        throw new AICommentServiceError('AI_INVALID_RESPONSE', 'AI 未返回合法 JSON');
      }
      return validateAICommentAnalysis(parsed);
    } catch (error) {
      if (error instanceof AICommentServiceError) throw error;
      throw new AICommentServiceError('AI_REQUEST_FAILED', 'AI Provider 请求失败');
    } finally {
      clearTimeout(timeout);
    }
  }
}

function extractContent(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    throw new AICommentServiceError('AI_INVALID_RESPONSE', 'AI 响应缺少结构化内容');
  }
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new AICommentServiceError('AI_INVALID_RESPONSE', 'AI 响应缺少结构化内容');
  }
  const first = choices[0];
  if (!first || typeof first !== 'object') {
    throw new AICommentServiceError('AI_INVALID_RESPONSE', 'AI 响应缺少结构化内容');
  }
  const message = (first as { message?: unknown }).message;
  if (!message || typeof message !== 'object') {
    throw new AICommentServiceError('AI_INVALID_RESPONSE', 'AI 响应缺少结构化内容');
  }
  const content = (message as { content?: unknown }).content;
  if (typeof content !== 'string') {
    throw new AICommentServiceError('AI_INVALID_RESPONSE', 'AI 响应缺少结构化内容');
  }
  return content;
}
