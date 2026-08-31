// AI Trip Pipeline V2 · Stage 2 测试：
//   COMMENT_EVALUATION → 首条 relevant && usable 评论触发 INITIAL_GENERATION
//
// 覆盖：
// - 评估输入贯通（title / tripInput / aiContext / comment）与 Envelope 语义（trip === null）
// - 无关评论、relevant 但 unusable 评论均不得触发生成
// - 首条 usable 评论恰好触发一次 INITIAL_GENERATION 并落库完整 snapshot
// - 非法 INITIAL_GENERATION 响应一律拒绝落库（评论仍保存、currentPlan 仍为空）
// - AI 不可用不得导致评论创建失败，也不得伪造 currentPlan
// - 已有 currentPlan 时只评估、不更新（Stage 3 才实现 TRIP_UPDATE）
// - 并发：两条近同时到达的 usable 评论只能建立一个首版
//
// 不 mock 仓库：真实 JSON 落盘，每个用例独立临时目录；AI 一律使用可编程 stub。

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { JsonTripRepository } from '../src/repositories/json-trip-repository';
import { JsonCommentRepository } from '../src/repositories/json-comment-repository';
import { JsonUserRepository } from '../src/repositories/json-user-repository';
import { CommentService } from '../src/services/comment-service';
import { UnavailableAICommentService } from '../src/services/ai-comment-service';
import { TripPlanGenerationService } from '../src/services/trip-plan-generation-service';
import {
  CommentEvaluationAIService,
  CommentEvaluationAIError,
  UnavailableCommentEvaluationAIService,
} from '../src/services/comment-evaluation-ai-service';
import {
  InitialGenerationAIService,
  InitialGenerationAIError,
  UnavailableInitialGenerationAIService,
} from '../src/services/initial-generation-ai-service';
import {
  AICommentEvaluationEnvelope,
  CommentEvaluationAIInput,
} from '../src/types/ai-comment-evaluation';
import {
  AIInitialGenerationEnvelope,
  InitialGenerationAIInput,
} from '../src/types/ai-initial-generation';
import { validateCommentEvaluationEnvelope } from '../src/services/comment-evaluation-ai-validation';
import { validateInitialGenerationEnvelope } from '../src/services/initial-generation-ai-validation';
import { Trip } from '../src/types/trip';
import { TripAIContext } from '../src/types/ai-preprocess';
import { User } from '../src/types/user';
import { record } from './run-tests';

const userA: User = {
  id: 'usr_A',
  wechatOpenId: 'openid_A_private',
  nickname: '真实用户 A',
  avatarUrl: 'https://example.test/a.png',
  profileCompleted: true,
  createdAt: 1,
  updatedAt: 1,
};

const userB: User = {
  id: 'usr_B',
  wechatOpenId: 'openid_B_private',
  nickname: '真实用户 B',
  avatarUrl: 'https://example.test/b.png',
  profileCompleted: true,
  createdAt: 2,
  updatedAt: 2,
};

function aiContextFixture(): TripAIContext {
  return {
    schemaVersion: '1.0',
    requestType: 'PREPROCESS',
    status: 'success',
    createdAt: '2026-08-30T02:00:00.000Z',
    analysis: {
      title: '周末羽毛球局',
      intent: '周末和朋友打羽毛球并吃饭',
      constraints: { city: '广州' },
      activities: ['羽毛球', '聚餐'],
      missingInformation: ['具体时间未定'],
    },
    decision: { canGenerateTrip: false },
    trip: null,
    tripInput: {
      title: '周末羽毛球局',
      initialBrief: '周末约球顺便吃个饭',
    },
  };
}

function tripFixture(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip_T',
    title: '周末羽毛球局',
    status: 'ACTIVE',
    creatorId: 'usr_A',
    participantIds: ['usr_A', 'usr_B'],
    createdAt: '2026-08-30T02:00:00.000Z',
    roomCode: 'ABCDEFG',
    initialBrief: '周末约球顺便吃个饭',
    commentIds: [],
    constraintIds: [],
    aiContext: aiContextFixture(),
    ...overrides,
  };
}

function evaluationEnvelope(
  decision: { relevant: boolean; usable: boolean; updateRequired: boolean },
  overrides: Partial<AICommentEvaluationEnvelope> = {},
): AICommentEvaluationEnvelope {
  return {
    schemaVersion: '1.0',
    requestType: 'COMMENT_EVALUATION',
    status: 'success',
    analysis: { commentIntent: '测试意图' },
    decision: { ...decision, reason: '测试理由' },
    trip: null,
    ...overrides,
  };
}

function generationEnvelope(
  overrides: Partial<AIInitialGenerationEnvelope> = {},
): AIInitialGenerationEnvelope {
  return {
    schemaVersion: '1.0',
    requestType: 'INITIAL_GENERATION',
    status: 'success',
    analysis: {},
    decision: { tripChanged: true },
    trip: {
      title: '周末羽毛球局',
      summary: '下午打球，晚上吃粤菜',
      items: [
        {
          type: 'SPORT',
          title: '羽毛球',
          time: {
            start: '2026-09-05T15:00:00+08:00',
            end: '2026-09-05T17:00:00+08:00',
            timezone: 'Asia/Shanghai',
          },
          locationRequirement: { city: '广州', district: '天河区' },
        },
        {
          type: 'DINING',
          title: '晚餐',
          time: { start: '2026-09-05T18:00:00+08:00', timezone: 'Asia/Shanghai' },
          locationRequirement: { city: '广州' },
        },
      ],
    },
    ...overrides,
  };
}

interface EvaluationStub extends CommentEvaluationAIService {
  captured: CommentEvaluationAIInput[];
}

function stubEvaluationAI(options: {
  envelope?: AICommentEvaluationEnvelope;
  envelopeFor?: (input: CommentEvaluationAIInput) => AICommentEvaluationEnvelope;
  error?: CommentEvaluationAIError;
}): EvaluationStub {
  const captured: CommentEvaluationAIInput[] = [];
  return {
    source: 'mock' as const,
    captured,
    async evaluateComment(input: CommentEvaluationAIInput) {
      captured.push(input);
      if (options.error) throw options.error;
      if (options.envelopeFor) return options.envelopeFor(input);
      return options.envelope as AICommentEvaluationEnvelope;
    },
  };
}

interface GenerationStub extends InitialGenerationAIService {
  captured: InitialGenerationAIInput[];
}

function stubGenerationAI(options: {
  envelope?: AIInitialGenerationEnvelope;
  error?: InitialGenerationAIError;
  /** 在 AI 返回之前执行：用于模拟「生成期间别处已写入首版」的提交点竞态 */
  beforeResolve?: () => Promise<void> | void;
}): GenerationStub {
  const captured: InitialGenerationAIInput[] = [];
  return {
    source: 'mock' as const,
    captured,
    async generateInitialTrip(input: InitialGenerationAIInput) {
      captured.push(input);
      if (options.beforeResolve) await options.beforeResolve();
      if (options.error) throw options.error;
      return options.envelope as AIInitialGenerationEnvelope;
    },
  };
}

interface Harness {
  directory: string;
  trips: JsonTripRepository;
  comments: JsonCommentRepository;
  service: CommentService;
}

function setup(options: {
  evaluationAI?: CommentEvaluationAIService;
  generationAI?: InitialGenerationAIService;
  trip?: Trip;
}): Harness {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cotrip-stage2-'));
  fs.writeFileSync(
    path.join(directory, 'users.json'),
    JSON.stringify({ users: [userA, userB] }),
    'utf8',
  );
  const trips = new JsonTripRepository(path.join(directory, 'trips.json'));
  const comments = new JsonCommentRepository(path.join(directory, 'comments.json'));
  const users = new JsonUserRepository(path.join(directory, 'users.json'));
  const planGeneration = new TripPlanGenerationService(
    trips,
    options.evaluationAI ?? new UnavailableCommentEvaluationAIService(),
    options.generationAI ?? new UnavailableInitialGenerationAIService(),
  );
  const service = new CommentService(
    comments,
    trips,
    users,
    new UnavailableAICommentService(),
    undefined,
    planGeneration,
  );
  return { directory, trips, comments, service };
}

export async function runTripPlanGenerationTests(): Promise<void> {
  // ---------- COMMENT_EVALUATION 校验 ----------

  await record('stage2 evaluation validation: 合法 COMMENT_EVALUATION envelope 通过', () => {
    const result = validateCommentEvaluationEnvelope(
      evaluationEnvelope({ relevant: true, usable: true, updateRequired: false }),
    );
    assert.strictEqual(result.ok, true, '合法 envelope 必须通过验证');
  });

  await record('stage2 evaluation validation: trip 非 null 一律拒绝（评论判断不得生成行程）', () => {
    const result = validateCommentEvaluationEnvelope(
      evaluationEnvelope(
        { relevant: true, usable: true, updateRequired: false },
        { trip: { items: [] } as unknown as null },
      ),
    );
    assert.strictEqual(result.ok, false, '携带 itinerary 的评估 envelope 必须被拒绝');
    assert.strictEqual(result.failureReasonCode, 'AI_FORBIDDEN_ITINERARY');
  });

  await record('stage2 evaluation validation: decision 三字段必须是严格布尔值', () => {
    const envelope = evaluationEnvelope({ relevant: true, usable: true, updateRequired: false });
    const tampered = {
      ...envelope,
      decision: { ...envelope.decision, usable: 'true' as unknown as boolean },
    };
    const result = validateCommentEvaluationEnvelope(tampered);
    assert.strictEqual(result.ok, false, '字符串 "true" 不得当作 usable=true');
    assert.strictEqual(result.failureReasonCode, 'DECISION_FLAG_NOT_BOOLEAN');
  });

  await record('stage2 evaluation validation: requestType 非 COMMENT_EVALUATION 一律拒绝', () => {
    const result = validateCommentEvaluationEnvelope({
      ...evaluationEnvelope({ relevant: true, usable: true, updateRequired: false }),
      requestType: 'INITIAL_GENERATION',
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.failureReasonCode, 'INVALID_REQUEST_TYPE');
  });

  // ---------- COMMENT_EVALUATION 输入贯通 ----------

  await record('stage2 evaluation: 评论进入 evaluation provider，输入含 title/tripInput/aiContext/comment', async () => {
    const evaluationAI = stubEvaluationAI({
      envelope: evaluationEnvelope({ relevant: false, usable: false, updateRequired: false }),
    });
    const { directory, trips, service } = setup({ evaluationAI });
    try {
      await trips.create(tripFixture());
      await service.addComment('usr_A', 'trip_T', '哈哈哈哈');

      assert.strictEqual(evaluationAI.captured.length, 1, '每条评论必须恰好评估一次');
      const input = evaluationAI.captured[0];
      assert.strictEqual(input.title, '周末羽毛球局', 'title 必须进入评估输入');
      assert.strictEqual(
        input.tripInput.initialBrief,
        '周末约球顺便吃个饭',
        'tripInput 必须携带创建时原始输入',
      );
      assert.ok(input.aiContext, 'aiContext 必须进入评估输入');
      assert.strictEqual(input.aiContext!.requestType, 'PREPROCESS');
      assert.strictEqual(input.comment.rawText, '哈哈哈哈', '当前评论必须进入评估输入');
      assert.strictEqual(
        (input.comment as unknown as { userId?: string }).userId,
        undefined,
        '评估输入不得携带评论作者身份（隐私最小化）',
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  await record('stage2 evaluation: 评估结果（relevant/usable/updateRequired/reason）被持久化', async () => {
    const evaluationAI = stubEvaluationAI({
      envelope: evaluationEnvelope({ relevant: true, usable: false, updateRequired: false }),
    });
    const { directory, trips, comments, service } = setup({ evaluationAI });
    try {
      await trips.create(tripFixture());
      await service.addComment('usr_A', 'trip_T', '我觉得可以');

      // 重新从磁盘读取：Stage 3 必须能知道该评论已评估过
      const reloaded = new JsonCommentRepository(path.join(directory, 'comments.json'));
      const stored = await reloaded.listByTrip('trip_T');
      assert.strictEqual(stored.length, 1);
      const evaluation = stored[0].evaluation;
      assert.ok(evaluation, '评估记录必须被持久化');
      assert.strictEqual(evaluation!.status, 'evaluated');
      if (evaluation!.status === 'evaluated') {
        assert.strictEqual(evaluation.relevant, true);
        assert.strictEqual(evaluation.usable, false);
        assert.strictEqual(evaluation.updateRequired, false);
        assert.strictEqual(evaluation.reason, '测试理由');
        assert.strictEqual(evaluation.requestType, 'COMMENT_EVALUATION');
      }
      assert.strictEqual(comments === comments, true);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  // ---------- 不得触发生成的评论 ----------

  await record('stage2 trigger: 无关评论（relevant=false）不触发 INITIAL_GENERATION', async () => {
    const evaluationAI = stubEvaluationAI({
      envelope: evaluationEnvelope({ relevant: false, usable: false, updateRequired: false }),
    });
    const generationAI = stubGenerationAI({ envelope: generationEnvelope() });
    const { directory, trips, service } = setup({ evaluationAI, generationAI });
    try {
      await trips.create(tripFixture());
      const comment = await service.addComment('usr_A', 'trip_T', '哈哈哈哈');

      assert.strictEqual(comment.rawText, '哈哈哈哈', '评论必须正常保存');
      assert.strictEqual(generationAI.captured.length, 0, '无关评论绝不触发首版生成');
      const trip = await trips.findById('trip_T');
      assert.strictEqual(trip!.currentPlan, undefined, 'currentPlan 必须仍为空');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  await record('stage2 trigger: relevant 但 unusable 评论不触发 INITIAL_GENERATION', async () => {
    const evaluationAI = stubEvaluationAI({
      envelope: evaluationEnvelope({ relevant: true, usable: false, updateRequired: false }),
    });
    const generationAI = stubGenerationAI({ envelope: generationEnvelope() });
    const { directory, trips, service } = setup({ evaluationAI, generationAI });
    try {
      await trips.create(tripFixture());
      const comment = await service.addComment('usr_A', 'trip_T', '我觉得可以');

      assert.strictEqual(comment.rawText, '我觉得可以', '评论必须正常保存');
      assert.strictEqual(
        generationAI.captured.length,
        0,
        'relevant 但 unusable 的评论绝不触发首版生成',
      );
      const trip = await trips.findById('trip_T');
      assert.strictEqual(trip!.currentPlan, undefined, 'currentPlan 必须仍为空');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  // ---------- 首条 usable 评论触发生成 ----------

  await record('stage2 generation: 首条 usable 评论恰好触发一次 INITIAL_GENERATION 并落库', async () => {
    const evaluationAI = stubEvaluationAI({
      envelope: evaluationEnvelope({ relevant: true, usable: true, updateRequired: false }),
    });
    const generationAI = stubGenerationAI({ envelope: generationEnvelope() });
    const { directory, trips, service } = setup({ evaluationAI, generationAI });
    try {
      await trips.create(tripFixture());
      await service.addComment('usr_A', 'trip_T', '我们下午三点开始打羽毛球');

      assert.strictEqual(generationAI.captured.length, 1, 'INITIAL_GENERATION 必须恰好调用一次');
      const input = generationAI.captured[0];
      assert.strictEqual(input.title, '周末羽毛球局', '生成输入必须含 title');
      assert.strictEqual(
        input.tripInput.initialBrief,
        '周末约球顺便吃个饭',
        '生成输入必须含创建时原始 tripInput',
      );
      assert.ok(input.aiContext, '生成输入必须含 aiContext');
      assert.strictEqual(
        input.triggeringComment.rawText,
        '我们下午三点开始打羽毛球',
        '生成输入必须含触发评论',
      );

      const trip = await trips.findById('trip_T');
      assert.ok(trip!.currentPlan, '首版行程必须被持久化');
      assert.strictEqual(trip!.currentPlan!.version, 1, '首版 version 必须为 1');
      assert.strictEqual(trip!.currentPlan!.tripId, 'trip_T');
      assert.strictEqual(trip!.currentPlan!.events.length, 2, '完整 snapshot 必须包含全部条目');
      assert.strictEqual(trip!.currentPlan!.events[0].type, 'SPORT');
      assert.strictEqual(trip!.currentPlan!.events[0].title, '羽毛球');
      assert.strictEqual(
        trip!.currentPlan!.events[0].time.start,
        '2026-09-05T15:00:00+08:00',
        '时间必须是带时区的 ISO-8601',
      );
      assert.strictEqual(trip!.currentPlan!.summary, '下午打球，晚上吃粤菜');
      // 标题归用户所有：不被 AI 回显覆盖
      assert.strictEqual(trip!.title, '周末羽毛球局', 'Trip.title 不得被 AI 输出覆盖');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  await record('stage2 generation: 首版 snapshot 重启后仍在（原子落盘）', async () => {
    const evaluationAI = stubEvaluationAI({
      envelope: evaluationEnvelope({ relevant: true, usable: true, updateRequired: false }),
    });
    const generationAI = stubGenerationAI({ envelope: generationEnvelope() });
    const { directory, trips, service } = setup({ evaluationAI, generationAI });
    try {
      await trips.create(tripFixture());
      await service.addComment('usr_A', 'trip_T', '我们下午三点开始打羽毛球');

      const restarted = new JsonTripRepository(path.join(directory, 'trips.json'));
      const trip = await restarted.findById('trip_T');
      assert.ok(trip!.currentPlan, '重启后首版行程必须仍在');
      assert.strictEqual(trip!.currentPlan!.events.length, 2);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  await record('stage2 generation: 「晚上不要吃辣，改成粤菜」在无 itinerary 时可作为首条 usable 评论触发生成', async () => {
    const evaluationAI = stubEvaluationAI({
      // 该评论 updateRequired=true，但当前尚无 itinerary，仍应触发首版生成
      envelope: evaluationEnvelope({ relevant: true, usable: true, updateRequired: true }),
    });
    const generationAI = stubGenerationAI({ envelope: generationEnvelope() });
    const { directory, trips, service } = setup({ evaluationAI, generationAI });
    try {
      await trips.create(tripFixture());
      await service.addComment('usr_A', 'trip_T', '晚上不要吃辣，改成粤菜');

      assert.strictEqual(
        generationAI.captured.length,
        1,
        '尚无 itinerary 时 updateRequired=true 的 usable 评论仍应触发首版生成',
      );
      const trip = await trips.findById('trip_T');
      assert.ok(trip!.currentPlan, '首版行程必须被持久化');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  // ---------- INITIAL_GENERATION 校验 ----------

  await record('stage2 generation validation: 合法 INITIAL_GENERATION envelope 通过', () => {
    const result = validateInitialGenerationEnvelope(generationEnvelope());
    assert.strictEqual(result.ok, true, '合法生成 envelope 必须通过验证');
  });

  await record('stage2 generation validation: trip=null / 空 items 一律拒绝', () => {
    const nullTrip = validateInitialGenerationEnvelope(
      generationEnvelope({ trip: null as unknown as AIInitialGenerationEnvelope['trip'] }),
    );
    assert.strictEqual(nullTrip.ok, false, 'INITIAL_GENERATION 的 trip 不得为 null');
    assert.strictEqual(nullTrip.failureReasonCode, 'TRIP_SNAPSHOT_REQUIRED');

    const emptyItems = validateInitialGenerationEnvelope(
      generationEnvelope({
        trip: { title: 't', summary: 's', items: [] },
      }),
    );
    assert.strictEqual(emptyItems.ok, false, '空 itinerary 不是有效首版');
    assert.strictEqual(emptyItems.failureReasonCode, 'TRIP_ITEMS_EMPTY');
  });

  await record('stage2 generation validation: requestType / schemaVersion 非法一律拒绝', () => {
    const wrongType = validateInitialGenerationEnvelope({
      ...generationEnvelope(),
      requestType: 'COMMENT_EVALUATION',
    });
    assert.strictEqual(wrongType.ok, false);
    assert.strictEqual(wrongType.failureReasonCode, 'INVALID_REQUEST_TYPE');

    const badVersion = validateInitialGenerationEnvelope({
      ...generationEnvelope(),
      schemaVersion: '',
    });
    assert.strictEqual(badVersion.ok, false);
    assert.strictEqual(badVersion.failureReasonCode, 'SCHEMA_VERSION_REQUIRED');
  });

  await record('stage2 generation validation: 自然语言时间与非法 trip schema 一律拒绝', () => {
    const naturalLanguageTime = validateInitialGenerationEnvelope(
      generationEnvelope({
        trip: {
          title: 't',
          summary: 's',
          items: [
            {
              type: 'SPORT',
              title: '羽毛球',
              time: { start: '下午三点', timezone: 'Asia/Shanghai' },
            },
          ],
        },
      }),
    );
    assert.strictEqual(naturalLanguageTime.ok, false, '「下午三点」不得作为结构化时间');
    assert.strictEqual(naturalLanguageTime.failureReasonCode, 'ITEM_TIME_START_NOT_ISO');

    const noTimezone = validateInitialGenerationEnvelope(
      generationEnvelope({
        trip: {
          title: 't',
          summary: 's',
          items: [
            {
              type: 'SPORT',
              title: '羽毛球',
              time: { start: '2026-09-05T15:00:00', timezone: 'Asia/Shanghai' },
            },
          ],
        },
      }),
    );
    assert.strictEqual(noTimezone.ok, false, '缺时区偏移的时间必须被拒绝');

    const badType = validateInitialGenerationEnvelope(
      generationEnvelope({
        trip: {
          title: 't',
          summary: 's',
          items: [
            {
              type: 'KARAOKE' as never,
              title: 'K 歌',
              time: { start: '2026-09-05T15:00:00+08:00', timezone: 'Asia/Shanghai' },
            },
          ],
        },
      }),
    );
    assert.strictEqual(badType.ok, false, '未知事件类型必须被拒绝');
    assert.strictEqual(badType.failureReasonCode, 'ITEM_TYPE_INVALID');
  });

  await record('stage2 generation validation: AI 携带真实世界事实（场馆/价格）一律拒绝', () => {
    const withVenue = validateInitialGenerationEnvelope(
      generationEnvelope({
        trip: {
          title: 't',
          summary: 's',
          items: [
            {
              type: 'SPORT',
              title: '羽毛球',
              time: { start: '2026-09-05T15:00:00+08:00', timezone: 'Asia/Shanghai' },
              location: { id: 'poi_1', name: '天河体育中心', latitude: 23.1, longitude: 113.3 },
            } as never,
          ],
        },
      }),
    );
    assert.strictEqual(withVenue.ok, false, 'AI 不得越过 Provider 直接给出已验证地点');
    assert.strictEqual(withVenue.failureReasonCode, 'AI_FORBIDDEN_REAL_WORLD_FACT');

    const withPrice = validateInitialGenerationEnvelope(
      generationEnvelope({
        trip: {
          title: 't',
          summary: 's',
          items: [
            {
              type: 'DINING',
              title: '晚餐',
              time: { start: '2026-09-05T18:00:00+08:00', timezone: 'Asia/Shanghai' },
              price: { amount: 120, currency: 'CNY' },
            } as never,
          ],
        },
      }),
    );
    assert.strictEqual(withPrice.ok, false, 'AI 不得虚构价格');
    assert.strictEqual(withPrice.failureReasonCode, 'AI_FORBIDDEN_REAL_WORLD_FACT');
  });

  await record('stage2 generation: 非法 INITIAL_GENERATION 响应拒绝落库，评论仍保存', async () => {
    const evaluationAI = stubEvaluationAI({
      envelope: evaluationEnvelope({ relevant: true, usable: true, updateRequired: false }),
    });
    // AI 违反不变量：INITIAL_GENERATION 却返回 trip=null
    const generationAI = stubGenerationAI({
      envelope: generationEnvelope({
        trip: null as unknown as AIInitialGenerationEnvelope['trip'],
      }),
    });
    const { directory, trips, service } = setup({ evaluationAI, generationAI });
    try {
      await trips.create(tripFixture());
      const comment = await service.addComment('usr_A', 'trip_T', '我们下午三点开始打羽毛球');

      assert.strictEqual(generationAI.captured.length, 1, '生成调用必须已发生');
      assert.strictEqual(comment.rawText, '我们下午三点开始打羽毛球', '评论仍必须保存成功');
      const trip = await trips.findById('trip_T');
      assert.strictEqual(trip!.currentPlan, undefined, '非法响应绝不得落库为 currentPlan');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  // ---------- AI 不可用降级 ----------

  await record('stage2 degradation: COMMENT_EVALUATION 不可用时评论仍保存且不生成行程', async () => {
    const generationAI = stubGenerationAI({ envelope: generationEnvelope() });
    // evaluationAI 默认为 Unavailable
    const { directory, trips, comments, service } = setup({ generationAI });
    try {
      await trips.create(tripFixture());
      const comment = await service.addComment('usr_A', 'trip_T', '我们下午三点开始打羽毛球');

      assert.strictEqual(comment.rawText, '我们下午三点开始打羽毛球', '评论必须保存成功');
      assert.strictEqual(generationAI.captured.length, 0, '评估失败绝不触发生成');
      const trip = await trips.findById('trip_T');
      assert.strictEqual(trip!.currentPlan, undefined, '不得伪造 currentPlan');

      const stored = await comments.listByTrip('trip_T');
      const evaluation = stored[0].evaluation;
      assert.ok(evaluation, '评估不可用也必须留下具名记录');
      assert.strictEqual(evaluation!.status, 'unavailable', '绝不伪造成「已评估」');
      if (evaluation!.status === 'unavailable') {
        assert.strictEqual(evaluation.reasonCode, 'AI_NOT_CONFIGURED');
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  await record('stage2 degradation: 评估 provider 抛错不得导致评论创建失败', async () => {
    const evaluationAI = stubEvaluationAI({
      error: new CommentEvaluationAIError('AI_REQUEST_FAILED', '网关超时'),
    });
    const { directory, trips, service } = setup({ evaluationAI });
    try {
      await trips.create(tripFixture());
      const comment = await service.addComment('usr_A', 'trip_T', '随便说点什么');
      assert.strictEqual(comment.rawText, '随便说点什么', 'AI 异常不得影响评论创建');
      const trip = await trips.findById('trip_T');
      assert.strictEqual(trip!.currentPlan, undefined);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  await record('stage2 degradation: INITIAL_GENERATION 抛错不得导致评论创建失败或伪造行程', async () => {
    const evaluationAI = stubEvaluationAI({
      envelope: evaluationEnvelope({ relevant: true, usable: true, updateRequired: false }),
    });
    const generationAI = stubGenerationAI({
      error: new InitialGenerationAIError('AI_REQUEST_FAILED', '网关超时'),
    });
    const { directory, trips, service } = setup({ evaluationAI, generationAI });
    try {
      await trips.create(tripFixture());
      const comment = await service.addComment('usr_A', 'trip_T', '我们下午三点开始打羽毛球');

      assert.strictEqual(comment.rawText, '我们下午三点开始打羽毛球', '评论必须保存成功');
      const trip = await trips.findById('trip_T');
      assert.strictEqual(trip!.currentPlan, undefined, '生成失败绝不伪造 currentPlan');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  // ---------- 已有 currentPlan：只评估，不更新（Stage 3 才做 TRIP_UPDATE）----------

  await record('stage2 existing plan: 已有 currentPlan 时仍评估，但绝不更新行程', async () => {
    const evaluationAI = stubEvaluationAI({
      envelope: evaluationEnvelope({ relevant: true, usable: true, updateRequired: true }),
    });
    const generationAI = stubGenerationAI({ envelope: generationEnvelope() });
    const { directory, trips, comments, service } = setup({ evaluationAI, generationAI });
    try {
      const existingPlan = {
        id: 'plan_trip_T_v1',
        tripId: 'trip_T',
        version: 1,
        events: [
          {
            id: 'event_trip_T_1_1',
            type: 'SPORT' as const,
            title: '已有行程',
            time: { start: '2026-09-05T10:00:00+08:00', timezone: 'Asia/Shanghai' },
          },
        ],
        summary: '已有首版',
        satisfiedConstraintCount: 0,
        totalConstraintCount: 0,
        conflicts: [] as never[],
        updatedAt: '2026-09-01T00:00:00.000Z',
      };
      await trips.create(tripFixture({ currentPlan: existingPlan }));

      await service.addComment('usr_B', 'trip_T', '晚上不要吃辣，改成粤菜');

      assert.strictEqual(evaluationAI.captured.length, 1, '已有行程时评论仍必须被评估');
      assert.strictEqual(
        generationAI.captured.length,
        0,
        '已有 currentPlan 时不得再次执行 INITIAL_GENERATION',
      );

      const trip = await trips.findById('trip_T');
      assert.deepStrictEqual(
        trip!.currentPlan,
        existingPlan,
        'Stage 2 不实现 TRIP_UPDATE：currentPlan 必须原样不变',
      );

      // 判断结果仍需保存，供 Stage 3 消费
      const stored = await comments.listByTrip('trip_T');
      const evaluation = stored[0].evaluation;
      assert.ok(evaluation);
      assert.strictEqual(evaluation!.status, 'evaluated');
      if (evaluation!.status === 'evaluated') {
        assert.strictEqual(evaluation.updateRequired, true, 'updateRequired 必须被正确保存');
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  // ---------- 并发：首版唯一性 ----------

  await record('stage2 concurrency: 两条近同时 usable 评论只建立一个首版 currentPlan', async () => {
    const evaluationAI = stubEvaluationAI({
      envelope: evaluationEnvelope({ relevant: true, usable: true, updateRequired: false }),
    });
    // 生成故意让出事件循环，制造两条评论同时在途的竞态窗口
    const generationAI = stubGenerationAI({
      envelope: generationEnvelope(),
      beforeResolve: () => new Promise<void>((resolve) => setTimeout(resolve, 10)),
    });
    const { directory, trips, service } = setup({ evaluationAI, generationAI });
    try {
      await trips.create(tripFixture());

      // 不 await 第一条，直接并发提交第二条
      const [commentA, commentB] = await Promise.all([
        service.addComment('usr_A', 'trip_T', '我们下午三点开始打羽毛球'),
        service.addComment('usr_B', 'trip_T', '晚上吃粤菜吧'),
      ]);

      assert.ok(commentA.id !== commentB.id, '两条评论都必须独立保存');
      assert.strictEqual(
        generationAI.captured.length,
        1,
        '并发 usable 评论只能触发一次 INITIAL_GENERATION',
      );

      const trip = await trips.findById('trip_T');
      assert.ok(trip!.currentPlan, '必须存在首版行程');
      assert.strictEqual(trip!.currentPlan!.version, 1, '首版 version 必须为 1，不得被覆盖成第二版');
      assert.strictEqual(trip!.currentPlan!.events.length, 2, '首版必须是完整合法 snapshot');

      // 两条评论都必须完成评估并保存
      const restarted = new JsonCommentRepository(path.join(directory, 'comments.json'));
      const stored = await restarted.listByTrip('trip_T');
      assert.strictEqual(stored.length, 2, '并发评论不得互相覆盖');
      for (const comment of stored) {
        assert.ok(comment.evaluation, '每条评论都必须留下评估记录');
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  await record('stage2 concurrency: 生成期间首版已由别处写入时放弃本次结果（提交点 CAS）', async () => {
    const evaluationAI = stubEvaluationAI({
      envelope: evaluationEnvelope({ relevant: true, usable: true, updateRequired: false }),
    });
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cotrip-stage2-cas-'));
    try {
      fs.writeFileSync(
        path.join(directory, 'users.json'),
        JSON.stringify({ users: [userA, userB] }),
        'utf8',
      );
      const trips = new JsonTripRepository(path.join(directory, 'trips.json'));
      const comments = new JsonCommentRepository(path.join(directory, 'comments.json'));
      const users = new JsonUserRepository(path.join(directory, 'users.json'));

      const winnerPlan = {
        id: 'plan_trip_T_v1',
        tripId: 'trip_T',
        version: 1,
        events: [
          {
            id: 'event_trip_T_1_1',
            type: 'DINING' as const,
            title: '别处已写入的首版',
            time: { start: '2026-09-05T12:00:00+08:00', timezone: 'Asia/Shanghai' },
          },
        ],
        satisfiedConstraintCount: 0,
        totalConstraintCount: 0,
        conflicts: [] as never[],
        updatedAt: '2026-09-01T00:00:00.000Z',
      };

      // 模拟：本次 AI 生成期间，另一路径已经写入首版
      const generationAI = stubGenerationAI({
        envelope: generationEnvelope(),
        beforeResolve: async () => {
          const trip = await trips.findById('trip_T');
          await trips.update({ ...trip!, currentPlan: winnerPlan });
        },
      });
      const planGeneration = new TripPlanGenerationService(trips, evaluationAI, generationAI);
      const service = new CommentService(
        comments,
        trips,
        users,
        new UnavailableAICommentService(),
        undefined,
        planGeneration,
      );

      await trips.create(tripFixture());
      await service.addComment('usr_A', 'trip_T', '我们下午三点开始打羽毛球');

      const trip = await trips.findById('trip_T');
      assert.deepStrictEqual(
        trip!.currentPlan,
        winnerPlan,
        '提交点发现首版已存在时必须放弃本次生成结果，绝不覆盖',
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
}
