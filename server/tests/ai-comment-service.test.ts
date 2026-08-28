import assert from 'assert';
import { record } from './run-tests';
import { validateAICommentAnalysis } from '../src/services/ai-comment-validation';
import { OpenAICompatibleAICommentService } from '../src/services/openai-compatible-ai-comment-service';
import { AICommentServiceError } from '../src/services/ai-comment-service';

const input = {
  trip: { id: 'trip_T', title: '测试行程', initialBrief: '' },
  comment: {
    id: 'comment_1',
    tripId: 'trip_T',
    userId: 'usr_A',
    rawText: '我想吃越南菜',
    createdAt: '2026-08-28T10:00:00.000Z',
  },
  currentPlan: { events: [] },
  existingRelevantConstraints: [],
};

export async function runAICommentServiceTests(): Promise<void> {
  await record('AI schema: 合法结构化分析通过 domain validation', () => {
    const result = validateAICommentAnalysis({
      intent: 'preference',
      constraints: [{
        type: 'PREFERENCE',
        scope: 'DINING',
        priority: 'SOFT',
        value: { keyword: 'VIETNAMESE', note: '越南菜' },
      }],
      confidence: 0.96,
      requiresConfirmation: false,
    });
    assert.strictEqual(result.constraints[0].type, 'PREFERENCE');
  });

  await record('AI schema: 自由类型/非法领域值必须拒绝', () => {
    assert.throws(
      () => validateAICommentAnalysis({
        intent: 'preference',
        constraints: [{ type: 'FREE_TEXT', scope: 'DINING', priority: 'SOFT', value: {} }],
        confidence: 0.9,
        requiresConfirmation: false,
      }),
      (error: Error) => error instanceof AICommentServiceError
        && error.code === 'AI_INVALID_RESPONSE',
    );
  });

  await record('AI schema: 未声明字段必须严格拒绝', () => {
    assert.throws(
      () => validateAICommentAnalysis({
        intent: 'chat',
        constraints: [],
        confidence: 0.8,
        requiresConfirmation: false,
        arbitraryOutput: '不得进入领域模型',
      }),
      (error: Error) => error instanceof AICommentServiceError
        && error.code === 'AI_INVALID_RESPONSE',
    );
  });

  await record('AI provider: OpenAI-compatible adapter 解析严格 JSON', async () => {
    let requestedUrl = '';
    let authorization = '';
    const service = new OpenAICompatibleAICommentService({
      baseUrl: 'https://ai.example.test/v1/',
      apiKey: 'server-only-key',
      model: 'comment-model',
      fetchImpl: async (url, init) => {
        requestedUrl = url;
        authorization = init.headers.Authorization;
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  intent: 'preference',
                  constraints: [{
                    type: 'PREFERENCE',
                    scope: 'DINING',
                    priority: 'SOFT',
                    value: { keyword: 'VIETNAMESE' },
                  }],
                  confidence: 0.9,
                  requiresConfirmation: false,
                }),
              },
            }],
          }),
        };
      },
    });
    const analysis = await service.analyzeComment(input);
    assert.strictEqual(requestedUrl, 'https://ai.example.test/v1/chat/completions');
    assert.strictEqual(authorization, 'Bearer server-only-key');
    assert.strictEqual(analysis.intent, 'preference');
  });
}
