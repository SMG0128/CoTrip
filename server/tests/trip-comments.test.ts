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
  service: CommentService;
}

function setup(): Harness {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cotrip-comments-'));
  const trips = new JsonTripRepository(path.join(directory, 'trips.json'));
  const comments = new JsonCommentRepository(path.join(directory, 'comments.json'));
  const service = new CommentService(comments, trips);
  return { directory, trips, comments, service };
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
}
