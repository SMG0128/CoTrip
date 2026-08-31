// AI Trip Pipeline V2 · PREPROCESS 阶段测试：
// - title 贯通创建请求 → validation → 持久化 → PREPROCESS AI 输入
// - PREPROCESS Envelope 语义：requestType === 'PREPROCESS'、trip === null、
//   decision.canGenerateTrip === false
// - 创建行程绝不因 AI 调用写入 itinerary（currentPlan 恒缺省）
// - AI 不可用/响应非法时优雅降级：行程照常创建，不写入 aiContext

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { JsonTripRepository } from '../src/repositories/json-trip-repository';
import { RealTripService } from '../src/services/trip-service';
import {
  AITripPreprocessEnvelope,
  TripPreprocessAIInput,
} from '../src/types/ai-preprocess';
import { TripPreprocessAIError } from '../src/services/trip-preprocess-ai-service';
import { buildTripAIContext, validatePreprocessEnvelope } from '../src/services/trip-preprocess-ai-validation';
import { Trip } from '../src/types/trip';
import { record } from './run-tests';

function temporaryStore(): { directory: string; file: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cotrip-preprocess-'));
  return { directory, file: path.join(directory, 'trips.json') };
}

/** 可编程 Stub：记录输入、返回指定 envelope 或抛错 */
function stubPreprocessAI(options: {
  envelope?: AITripPreprocessEnvelope;
  error?: TripPreprocessAIError;
  captured?: TripPreprocessAIInput[];
}) {
  return {
    source: 'mock' as const,
    async preprocess(input: TripPreprocessAIInput): Promise<AITripPreprocessEnvelope> {
      options.captured?.push(input);
      if (options.error) throw options.error;
      return options.envelope as AITripPreprocessEnvelope;
    },
  };
}

function validEnvelope(overrides: Partial<AITripPreprocessEnvelope> = {}): AITripPreprocessEnvelope {
  return {
    schemaVersion: '1.0',
    requestType: 'PREPROCESS',
    status: 'success',
    analysis: {
      title: '顺德美食之旅',
      intent: '周末去顺德品尝美食',
      constraints: { time: '周末' },
      activities: ['觅食', '逛街'],
      missingInformation: ['预算未提供'],
    },
    decision: { canGenerateTrip: false },
    trip: null,
    ...overrides,
  };
}

export async function runTripPreprocessTests(): Promise<void> {
  await record('preprocess validation: 合法 PREPROCESS envelope 通过验证', () => {
    const result = validatePreprocessEnvelope(validEnvelope());
    assert.strictEqual(result.ok, true, '合法 envelope 必须通过验证');
  });

  await record('preprocess validation: trip 非 null 一律拒绝（禁止 AI itinerary）', () => {
    const withPlan = validatePreprocessEnvelope(
      validEnvelope({ trip: { anything: 'itinerary' } as unknown as null }),
    );
    assert.strictEqual(withPlan.ok, false, '携带 itinerary 的 envelope 必须被拒绝');
    assert.strictEqual(withPlan.failureReasonCode, 'AI_FORBIDDEN_ITINERARY');

    const withObject = validatePreprocessEnvelope({ ...validEnvelope(), trip: {} });
    assert.strictEqual(withObject.ok, false, 'trip 为对象时必须被拒绝');
  });

  await record('preprocess validation: canGenerateTrip !== false 一律拒绝', () => {
    const result = validatePreprocessEnvelope(
      validEnvelope({ decision: { canGenerateTrip: true } }),
    );
    assert.strictEqual(result.ok, false, 'canGenerateTrip=true 必须被拒绝');
    assert.strictEqual(result.failureReasonCode, 'AI_FORBIDDEN_GENERATION_FLAG');
  });

  await record('preprocess validation: requestType 非 PREPROCESS 一律拒绝', () => {
    const result = validatePreprocessEnvelope({
      ...validEnvelope(),
      requestType: 'INITIAL_GENERATION',
    });
    assert.strictEqual(result.ok, false, 'requestType 必须为 PREPROCESS');
    assert.strictEqual(result.failureReasonCode, 'INVALID_REQUEST_TYPE');
  });

  await record('preprocess service: title 与 tripInput 进入 AI 输入且 title 被持久化', async () => {
    const temp = temporaryStore();
    try {
      const repo = new JsonTripRepository(temp.file);
      const captured: TripPreprocessAIInput[] = [];
      const ai = stubPreprocessAI({ envelope: validEnvelope(), captured });
      const service = new RealTripService(repo, Math.random, ai as never);

      const trip = await service.createTrip('usr_123', {
        title: '顺德美食之旅',
        initialBrief: '周末去顺德吃东西',
      });

      assert.strictEqual(captured.length, 1, '创建行程必须恰好发起一次 PREPROCESS 调用');
      const input = captured[0];
      assert.strictEqual(input.title, '顺德美食之旅', 'title 必须进入 PREPROCESS AI 输入');
      assert.strictEqual(input.tripInput.title, '顺德美食之旅', 'tripInput.title 必须与创建 title 一致');
      assert.strictEqual(
        input.tripInput.initialBrief,
        '周末去顺德吃东西',
        'tripInput.initialBrief 必须携带原始行程简述',
      );

      assert.strictEqual(trip.title, '顺德美食之旅', 'title 必须被持久化');
      assert.ok(trip.aiContext, 'PREPROCESS 成功后必须写入 aiContext');
      assert.strictEqual(trip.aiContext!.requestType, 'PREPROCESS');
      assert.strictEqual(trip.aiContext!.trip, null, 'aiContext.trip 必须为 null');
      assert.strictEqual(trip.aiContext!.decision.canGenerateTrip, false);
      assert.deepStrictEqual(trip.aiContext!.tripInput.initialBrief, '周末去顺德吃东西');

      const reloaded = await repo.findById(trip.id);
      assert.ok(reloaded?.aiContext, 'aiContext 必须被持久化并可重新取得');
      assert.strictEqual(reloaded.aiContext!.requestType, 'PREPROCESS');
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('preprocess service: 创建行程绝不写入 AI itinerary', async () => {
    const temp = temporaryStore();
    try {
      const repo = new JsonTripRepository(temp.file);
      const captured: TripPreprocessAIInput[] = [];
      const ai = stubPreprocessAI({ envelope: validEnvelope(), captured });
      const service = new RealTripService(repo, Math.random, ai as never);

      const trip = await service.createTrip('usr_123', {
        title: '顺德美食之旅',
        initialBrief: '周末去顺德吃东西',
      });

      assert.strictEqual(trip.currentPlan, undefined, '创建行程后 currentPlan 必须缺省');
      assert.strictEqual(trip.aiContext!.trip, null, 'aiContext 不得携带任何 itinerary');
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('preprocess service: AI 响应非法时优雅降级，行程照常创建且不写入 aiContext', async () => {
    const temp = temporaryStore();
    try {
      const repo = new JsonTripRepository(temp.file);
      const captured: TripPreprocessAIInput[] = [];
      // AI 违反不变量：试图携带 itinerary
      const ai = stubPreprocessAI({
        envelope: validEnvelope({ trip: { days: [] } as unknown as null }),
        captured,
      });
      const service = new RealTripService(repo, Math.random, ai as never);

      const trip = await service.createTrip('usr_123', {
        title: '顺德美食之旅',
        initialBrief: '周末去顺德吃东西',
      });

      assert.strictEqual(captured.length, 1, 'PREPROCESS 调用必须已发生');
      assert.strictEqual(trip.title, '顺德美食之旅', 'AI 非法时行程仍必须创建成功');
      assert.strictEqual(trip.aiContext, undefined, '非法 AI 响应不得写入 aiContext');
      assert.strictEqual(trip.currentPlan, undefined, '绝不写入 AI itinerary');
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('preprocess service: AI 不可用时优雅降级，行程照常创建', async () => {
    const temp = temporaryStore();
    try {
      const repo = new JsonTripRepository(temp.file);
      const ai = stubPreprocessAI({
        error: new TripPreprocessAIError('AI_NOT_CONFIGURED', 'PREPROCESS AI Provider 尚未配置'),
      });
      const service = new RealTripService(repo, Math.random, ai as never);

      const trip = await service.createTrip('usr_123', {
        title: '顺德美食之旅',
        initialBrief: '周末去顺德吃东西',
      });

      assert.strictEqual(trip.title, '顺德美食之旅', 'AI 不可用时行程仍必须创建成功');
      assert.strictEqual(trip.aiContext, undefined, 'AI 不可用时不得伪造 aiContext');
      assert.strictEqual(trip.currentPlan, undefined);
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('preprocess service: title 服务端 validation 拒绝空标题与超长标题', async () => {
    const temp = temporaryStore();
    try {
      const repo = new JsonTripRepository(temp.file);
      const service = new RealTripService(repo);

      await assert.rejects(
        () => service.createTrip('usr_123', { title: '   ', initialBrief: '' }),
        (error: { code?: string }) => error.code === 'VALIDATION_ERROR',
        '空标题必须被服务端 validation 拒绝',
      );

      await assert.rejects(
        () => service.createTrip('usr_123', { title: 'x'.repeat(101), initialBrief: '' }),
        (error: { code?: string }) => error.code === 'VALIDATION_ERROR',
        '超过 100 字符的标题必须被服务端 validation 拒绝',
      );
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('preprocess context: buildTripAIContext 输出固定语义（trip null / canGenerateTrip false）', () => {
    const envelope = validEnvelope();
    const tripInput: TripPreprocessAIInput['tripInput'] = {
      title: '顺德美食之旅',
      initialBrief: '周末去顺德吃东西',
    };
    const context = buildTripAIContext(envelope, tripInput, '2026-08-31T00:00:00.000Z');
    assert.strictEqual(context.requestType, 'PREPROCESS');
    assert.strictEqual(context.trip, null);
    assert.strictEqual(context.decision.canGenerateTrip, false);
    assert.strictEqual(context.schemaVersion, '1.0');
    assert.strictEqual(context.createdAt, '2026-08-31T00:00:00.000Z');
    assert.deepStrictEqual(context.tripInput, tripInput);
    const persisted: Pick<Trip, 'aiContext'> = { aiContext: context };
    assert.ok(persisted.aiContext);
  });
}
