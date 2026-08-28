// server/tests/trip-comments.test.ts
// 共享评论流集成测试：验证多人在同一 Trip 下的评论共享、持久化、跨行程隔离与并发追加。
// 不 mock：真实 JSON 仓库落盘，每次用例使用独立临时目录。

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { JsonTripRepository } from '../src/repositories/json-trip-repository';
import { JsonCommentRepository } from '../src/repositories/json-comment-repository';
import { CommentService } from '../src/services/comment-service';
import { Trip } from '../src/types/trip';
import { User } from '../src/types/user';
import { JsonUserRepository } from '../src/repositories/json-user-repository';
import { AICommentService, UnavailableAICommentService } from '../src/services/ai-comment-service';
import { record } from './run-tests';

function fixture(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip_T',
    title: '共享行程',
    status: 'ACTIVE',
    creatorId: 'usr_A',
    participantIds: ['usr_A'],
    createdAt: '2026-08-20T10:00:00.000Z',
    roomCode: 'ABCDEFG',
    initialBrief: 'fixture trip',
    commentIds: [],
    constraintIds: [],
    ...overrides,
  };
}

interface Harness {
  directory: string;
  trips: JsonTripRepository;
  comments: JsonCommentRepository;
  users: JsonUserRepository;
  service: CommentService;
}

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

function setup(ai: AICommentService = new UnavailableAICommentService()): Harness {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cotrip-comments-'));
  fs.writeFileSync(
    path.join(directory, 'users.json'),
    JSON.stringify({ users: [userA, userB] }),
    'utf8',
  );
  const trips = new JsonTripRepository(path.join(directory, 'trips.json'));
  const comments = new JsonCommentRepository(path.join(directory, 'comments.json'));
  const users = new JsonUserRepository(path.join(directory, 'users.json'));
  const service = new CommentService(comments, trips, users, ai);
  return { directory, trips, comments, users, service };
}

export async function runTripCommentTests(): Promise<void> {
  await record('comments case1: A 发表 A1，成员 B GET 必须看到 A1（共享实体读取）', async () => {
    const { directory, trips, service } = setup();
    try {
      // A 创建行程 T；B 随后加入成为成员
      await trips.create(fixture());
      await trips.addParticipant('trip_T', 'usr_B');
      await service.addComment('usr_A', 'trip_T', 'A1');
      const seenByB = await service.listComments('usr_B', 'trip_T');
      assert.ok(
        seenByB.some((c) => c.rawText === 'A1' && c.userId === 'usr_A'),
        'B 必须看到 A 发表的 A1',
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  await record('comments case2: B 追加 B1 后，A GET 顺序为 [A1, B1]（追加不覆盖）', async () => {
    const { directory, trips, service } = setup();
    try {
      await trips.create(fixture());
      await trips.addParticipant('trip_T', 'usr_B');
      await service.addComment('usr_A', 'trip_T', 'A1');
      await service.addComment('usr_B', 'trip_T', 'B1');
      const list = await service.listComments('usr_A', 'trip_T');
      assert.deepStrictEqual(
        list.map((c) => c.rawText),
        ['A1', 'B1'],
        'A GET 必须同时看到 A1 与 B1，且按创建顺序排列',
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  await record('comments case3: 重新创建仓库（模拟退出重进/服务重启）后评论仍在', async () => {
    const { directory, trips, service } = setup();
    try {
      await trips.create(fixture());
      await trips.addParticipant('trip_T', 'usr_B');
      await service.addComment('usr_A', 'trip_T', 'A1');
      await service.addComment('usr_B', 'trip_T', 'B1');
      // 全新仓库实例从同一文件读取：评论不能因“重新进入”而消失
      const restarted = new CommentService(
        new JsonCommentRepository(path.join(directory, 'comments.json')),
        new JsonTripRepository(path.join(directory, 'trips.json')),
        new JsonUserRepository(path.join(directory, 'users.json')),
        new UnavailableAICommentService(),
      );
      const list = await restarted.listComments('usr_A', 'trip_T');
      assert.deepStrictEqual(
        list.map((c) => c.rawText),
        ['A1', 'B1'],
        '退出/重启后评论必须完整保留',
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  await record('comments case4: 不同 Trip 之间评论隔离（跨行程不泄漏）', async () => {
    const { directory, trips, service } = setup();
    try {
      await trips.create(fixture());
      await trips.create(fixture({ id: 'trip_T2', roomCode: 'QWERTYU' }));
      await service.addComment('usr_A', 'trip_T', 'A1');
      const t2List = await service.listComments('usr_A', 'trip_T2');
      assert.deepStrictEqual(t2List, [], 'T2 的评论流不能包含 T 的评论');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  await record('comments case5: A/B 快速连续发表全部保留（无 last-write-wins 覆盖）', async () => {
    const { directory, trips, service } = setup();
    try {
      await trips.create(fixture());
      await trips.addParticipant('trip_T', 'usr_B');
      await Promise.all([
        service.addComment('usr_A', 'trip_T', 'A1'),
        service.addComment('usr_B', 'trip_T', 'B1'),
        service.addComment('usr_A', 'trip_T', 'A2'),
        service.addComment('usr_B', 'trip_T', 'B2'),
      ]);
      const list = await service.listComments('usr_A', 'trip_T');
      const texts = list.map((c) => c.rawText);
      for (const expected of ['A1', 'B1', 'A2', 'B2']) {
        assert.ok(texts.includes(expected), `并发追加后必须包含 ${expected}`);
      }
      assert.strictEqual(list.length, 4, '四条评论必须全部存在，不能互相覆盖');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  await record('comments 权限: 非成员读取评论流被拒绝（TRIP_FORBIDDEN）', async () => {
    const { directory, trips, service } = setup();
    try {
      await trips.create(fixture());
      await service.addComment('usr_A', 'trip_T', 'A1');
      await assert.rejects(
        () => service.listComments('usr_outsider', 'trip_T'),
        (error: Error & { status?: number; code?: string }) =>
          error.status === 403 && error.code === 'TRIP_FORBIDDEN',
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  await record('comments 校验: 空白评论被拒绝（COMMENT_INVALID_INPUT）', async () => {
    const { directory, trips, service } = setup();
    try {
      await trips.create(fixture());
      await assert.rejects(
        () => service.addComment('usr_A', 'trip_T', '   '),
        (error: Error & { code?: string }) => error.code === 'COMMENT_INVALID_INPUT',
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  await record('comments 作者: A/B 互看均返回最新 PublicUser 投影且不泄露 openid', async () => {
    const { directory, trips, users, service } = setup();
    try {
      await trips.create(fixture());
      await trips.addParticipant('trip_T', 'usr_B');
      await service.addComment('usr_A', 'trip_T', 'A1');
      await service.addComment('usr_B', 'trip_T', 'B1');

      const seenByA = await service.listComments('usr_A', 'trip_T');
      const seenByB = await service.listComments('usr_B', 'trip_T');
      const aFromB = seenByB.find((comment) => comment.userId === 'usr_A');
      const bFromA = seenByA.find((comment) => comment.userId === 'usr_B');
      assert.deepStrictEqual(aFromB?.author, {
        id: userA.id,
        nickname: userA.nickname,
        avatarUrl: userA.avatarUrl,
      });
      assert.deepStrictEqual(bFromA?.author, {
        id: userB.id,
        nickname: userB.nickname,
        avatarUrl: userB.avatarUrl,
      });
      assert.ok(!JSON.stringify(seenByA).includes('openid_'), 'CommentDTO 不得泄露 openid');

      await users.update({ ...userA, nickname: 'A 的新昵称', updatedAt: 3 });
      const refreshed = await service.listComments('usr_B', 'trip_T');
      assert.strictEqual(
        refreshed.find((comment) => comment.userId === 'usr_A')?.author.nickname,
        'A 的新昵称',
        '历史评论作者必须动态使用最新公开资料',
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  await record('comments AI failure: 评论仍持久化且服务端权威状态为 unresolved', async () => {
    const failingAI: AICommentService = {
      source: 'provider',
      analyzeComment: async () => { throw new Error('provider down'); },
    };
    const { directory, trips, service } = setup(failingAI);
    try {
      await trips.create(fixture());
      const created = await service.addComment('usr_A', 'trip_T', '我想吃越南菜');
      assert.strictEqual(created.aiStatus, 'unresolved');
      assert.strictEqual(created.aiSource, 'provider');

      const restarted = new CommentService(
        new JsonCommentRepository(path.join(directory, 'comments.json')),
        new JsonTripRepository(path.join(directory, 'trips.json')),
        new JsonUserRepository(path.join(directory, 'users.json')),
        new UnavailableAICommentService(),
      );
      const persisted = await restarted.listComments('usr_A', 'trip_T');
      assert.strictEqual(persisted.length, 1, 'AI 失败不能导致评论消失');
      assert.strictEqual(persisted[0].aiStatus, 'unresolved');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  await record('comments AI success: A/B GET 同一评论得到相同持久化 accepted 状态', async () => {
    const successfulAI: AICommentService = {
      source: 'provider',
      analyzeComment: async () => ({
        intent: 'preference',
        constraints: [{
          type: 'PREFERENCE',
          scope: 'DINING',
          priority: 'SOFT',
          value: { keyword: 'VIETNAMESE', note: '越南菜' },
        }],
        confidence: 0.95,
        requiresConfirmation: false,
      }),
    };
    const { directory, trips, service } = setup(successfulAI);
    try {
      await trips.create(fixture());
      await trips.addParticipant('trip_T', 'usr_B');
      const created = await service.addComment('usr_A', 'trip_T', '我想吃越南菜');
      const seenByA = await service.listComments('usr_A', 'trip_T');
      const seenByB = await service.listComments('usr_B', 'trip_T');
      assert.strictEqual(created.aiStatus, 'accepted');
      assert.strictEqual(seenByA[0].id, seenByB[0].id);
      assert.strictEqual(seenByA[0].aiStatus, 'accepted');
      assert.strictEqual(seenByB[0].aiStatus, 'accepted');
      assert.deepStrictEqual(seenByA[0].aiAnalysis, seenByB[0].aiAnalysis);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
}
