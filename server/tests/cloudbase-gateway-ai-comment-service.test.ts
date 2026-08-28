// server/tests/cloudbase-gateway-ai-comment-service.test.ts
// CloudBase HTTP Function 网关 adapter 测试。
// 全部使用注入 fetch，不真实访问 CloudBase / hy3。

import assert from 'assert';
import { record } from './run-tests';
import { CloudBaseGatewayAICommentService } from '../src/services/cloudbase-gateway-ai-comment-service';
import { AICommentServiceError } from '../src/services/ai-comment-service';

const input = {
  trip: {
    id: 'trip_T',
    title: '测试行程',
    initialBrief: '',
    timeRange: { start: '2026-09-05T10:00:00+08:00' },
  },
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

const validPayload = (): { ok: boolean; analysis: unknown } => ({
  ok: true,
  analysis: {
    intent: 'preference',
    constraints: [{
      type: 'PREFERENCE',
      scope: 'DINING',
      priority: 'SOFT',
      value: { keyword: 'VIETNAMESE' },
    }],
    confidence: 0.9,
    requiresConfirmation: false,
  },
});

interface MockInit {
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
}

function makeService(
  responder: (url: string, init: MockInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>,
): CloudBaseGatewayAICommentService {
  return new CloudBaseGatewayAICommentService({
    gatewayUrl: 'https://gateway.example.test/',
    secret: 'cotrip-server-secret',
    fetchImpl: responder,
  });
}

function expectRequestFailed(promise: Promise<unknown>): Promise<void> {
  return assert.rejects(
    promise,
    (error: unknown) => error instanceof AICommentServiceError && error.code === 'AI_REQUEST_FAILED',
  );
}

export async function runCloudBaseGatewayTests(): Promise<void> {
  await record('gateway: 200 valid → 成功', async () => {
    let requestedUrl = '';
    let authorization = '';
    const service = makeService(async (url, init) => {
      requestedUrl = url;
      authorization = init.headers.Authorization;
      return { ok: true, status: 200, json: async () => validPayload() };
    });
    const analysis = await service.analyzeComment(input);
    assert.strictEqual(requestedUrl, 'https://gateway.example.test/analyze');
    assert.strictEqual(authorization, 'Bearer cotrip-server-secret');
    assert.strictEqual(analysis.intent, 'preference');
    assert.strictEqual(analysis.constraints[0].value.keyword, 'VIETNAMESE');
  });

  await record('gateway: 401 → provider error', async () => {
    const service = makeService(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'UNAUTHORIZED' }),
    }));
    await expectRequestFailed(service.analyzeComment(input));
  });

  await record('gateway: 502 → provider error', async () => {
    const service = makeService(async () => ({
      ok: false,
      status: 502,
      json: async () => ({ error: 'AI_PROVIDER_FAILURE' }),
    }));
    await expectRequestFailed(service.analyzeComment(input));
  });

  await record('gateway: network error → provider error', async () => {
    const service = makeService(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expectRequestFailed(service.analyzeComment(input));
  });

  await record('gateway: timeout → provider error', async () => {
    const service = new CloudBaseGatewayAICommentService({
      gatewayUrl: 'https://gateway.example.test',
      secret: 's',
      timeoutMs: 20,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('Aborted')));
        }),
    });
    await expectRequestFailed(service.analyzeComment(input));
  });

  await record('gateway: 返回非法 schema → Server 拒绝', async () => {
    const service = makeService(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        analysis: { intent: 'hacked', constraints: [], confidence: 'x', requiresConfirmation: false },
      }),
    }));
    await assert.rejects(
      service.analyzeComment(input),
      (error: unknown) => error instanceof AICommentServiceError && error.code === 'AI_INVALID_RESPONSE',
    );
  });

  await record('gateway: 返回 undefined analysis → Server 拒绝', async () => {
    const service = makeService(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    await assert.rejects(
      service.analyzeComment(input),
      (error: unknown) => error instanceof AICommentServiceError && error.code === 'AI_INVALID_RESPONSE',
    );
  });
}
