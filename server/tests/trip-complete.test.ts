// Backend 完成行程闭环：权限（仅 creator）、状态机（幂等 / 拒绝非法迁移）与持久化测试。

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { JsonTripRepository } from '../src/repositories/json-trip-repository';
import { RealTripService } from '../src/services/trip-service';
import { AppError } from '../src/types/errors';
import { Trip } from '../src/types/trip';
import { record } from './run-tests';

function temporaryStore(): { directory: string; file: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cotrip-trip-complete-'));
  return { directory, file: path.join(directory, 'trips.json') };
}

function fixture(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip_complete',
    title: '顺德一日游',
    status: 'ACTIVE',
    creatorId: 'usr_123',
    participantIds: ['usr_123'],
    createdAt: '2026-08-20T10:00:00.000Z',
    roomCode: 'ABCDEFG',
    initialBrief: '周末去顺德吃东西',
    commentIds: ['cmt_1'],
    constraintIds: ['cst_1'],
    ...overrides,
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runTripCompleteTests(): Promise<void> {
  await record('completeTrip: creator 完成 ACTIVE 行程且除 status/completedAt 外字段不变', async () => {
    const temp = temporaryStore();
    try {
      const base = fixture({
        participantIds: ['usr_123', 'usr_456'],
        areaConstraint: { district: '顺德区' },
        timeRange: { start: '2026-08-23T09:00:00+08:00', end: '2026-08-23T21:00:00+08:00' },
      });
      const repo = new JsonTripRepository(temp.file);
      await repo.create(base);
      const service = new RealTripService(repo);

      const completed = await service.completeTrip('usr_123', 'trip_complete');
      assert.strictEqual(completed.status, 'COMPLETED');
      assert.ok(completed.completedAt, '完成后必须写入 completedAt');

      // 除 status/completedAt 外，id/roomCode/creatorId/participantIds/title/initialBrief/
      // commentIds/constraintIds/createdAt 及可选字段必须原样保留。
      assert.deepStrictEqual(completed, {
        ...base,
        status: 'COMPLETED',
        completedAt: completed.completedAt,
      });

      const stored = await repo.findById('trip_complete');
      assert.strictEqual(stored?.status, 'COMPLETED');
      assert.strictEqual(stored?.completedAt, completed.completedAt);
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('completeTrip: participant 但非 creator 返回 403 TRIP_FORBIDDEN', async () => {
    const temp = temporaryStore();
    try {
      const repo = new JsonTripRepository(temp.file);
      await repo.create(fixture({ participantIds: ['usr_123', 'usr_456'] }));
      const service = new RealTripService(repo);
      await assert.rejects(
        () => service.completeTrip('usr_456', 'trip_complete'),
        (error: AppError) => error.status === 403 && error.code === 'TRIP_FORBIDDEN',
      );
      const stored = await repo.findById('trip_complete');
      assert.strictEqual(stored?.status, 'ACTIVE', '被拒绝后状态不得改变');
      assert.strictEqual(stored?.completedAt, undefined);
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('completeTrip: 无关用户返回 403 TRIP_FORBIDDEN', async () => {
    const temp = temporaryStore();
    try {
      const repo = new JsonTripRepository(temp.file);
      await repo.create(fixture());
      const service = new RealTripService(repo);
      await assert.rejects(
        () => service.completeTrip('usr_999', 'trip_complete'),
        (error: AppError) => error.status === 403 && error.code === 'TRIP_FORBIDDEN',
      );
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('completeTrip: 行程不存在返回 404 TRIP_NOT_FOUND', async () => {
    const temp = temporaryStore();
    try {
      const service = new RealTripService(new JsonTripRepository(temp.file));
      await assert.rejects(
        () => service.completeTrip('usr_123', 'trip_missing'),
        (error: AppError) => error.status === 404 && error.code === 'TRIP_NOT_FOUND',
      );
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('completeTrip: 连续完成两次幂等，第二次不落盘且 completedAt 不变', async () => {
    const temp = temporaryStore();
    try {
      const repo = new JsonTripRepository(temp.file);
      await repo.create(fixture());
      const service = new RealTripService(repo);

      const first = await service.completeTrip('usr_123', 'trip_complete');
      assert.ok(first.completedAt, '第一次完成必须写入 completedAt');
      // 留出时钟间隔：若实现错误地重写 completedAt，两次时间戳将不同。
      await wait(30);
      const second = await service.completeTrip('usr_123', 'trip_complete');

      assert.strictEqual(second.status, 'COMPLETED');
      assert.strictEqual(second.completedAt, first.completedAt, 'completedAt 必须保持第一次的时间戳');
      assert.deepStrictEqual(second, first);
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('completeTrip: 完成结果持久化，重启后新实例仍读到 COMPLETED', async () => {
    const temp = temporaryStore();
    try {
      const first = new JsonTripRepository(temp.file);
      await first.create(fixture());
      const service = new RealTripService(first);
      const completed = await service.completeTrip('usr_123', 'trip_complete');

      const restarted = new JsonTripRepository(temp.file);
      const stored = await restarted.findById('trip_complete');
      assert.strictEqual(stored?.status, 'COMPLETED');
      assert.ok(stored?.completedAt, '重启后 completedAt 必须仍在');
      assert.strictEqual(stored?.completedAt, completed.completedAt);
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('completeTrip: 完成后 listForUser(ACTIVE) 不再包含该行程', async () => {
    const temp = temporaryStore();
    try {
      const repo = new JsonTripRepository(temp.file);
      await repo.create(fixture());
      const service = new RealTripService(repo);
      await service.completeTrip('usr_123', 'trip_complete');
      assert.deepStrictEqual((await repo.listForUser('usr_123', 'ACTIVE')).map((t) => t.id), []);
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('completeTrip: 完成后 listForUser(COMPLETED) 包含该行程', async () => {
    const temp = temporaryStore();
    try {
      const repo = new JsonTripRepository(temp.file);
      await repo.create(fixture());
      const service = new RealTripService(repo);
      await service.completeTrip('usr_123', 'trip_complete');
      assert.deepStrictEqual((await repo.listForUser('usr_123', 'COMPLETED')).map((t) => t.id), [
        'trip_complete',
      ]);
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('completeTrip: DRAFT 行程完成返回 409 TRIP_INVALID_STATUS_TRANSITION 且状态不变', async () => {
    const temp = temporaryStore();
    try {
      const repo = new JsonTripRepository(temp.file);
      await repo.create(fixture({ status: 'DRAFT' }));
      const service = new RealTripService(repo);
      await assert.rejects(
        () => service.completeTrip('usr_123', 'trip_complete'),
        (error: AppError) =>
          error.status === 409 && error.code === 'TRIP_INVALID_STATUS_TRANSITION',
      );
      const stored = await repo.findById('trip_complete');
      assert.strictEqual(stored?.status, 'DRAFT', '拒绝后状态不得被偷偷修改');
      assert.strictEqual(stored?.completedAt, undefined);
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('completeTrip: CANCELLED 行程完成返回 409 TRIP_INVALID_STATUS_TRANSITION 且状态不变', async () => {
    const temp = temporaryStore();
    try {
      const repo = new JsonTripRepository(temp.file);
      await repo.create(fixture({ status: 'CANCELLED' }));
      const service = new RealTripService(repo);
      await assert.rejects(
        () => service.completeTrip('usr_123', 'trip_complete'),
        (error: AppError) =>
          error.status === 409 && error.code === 'TRIP_INVALID_STATUS_TRANSITION',
      );
      const stored = await repo.findById('trip_complete');
      assert.strictEqual(stored?.status, 'CANCELLED', '拒绝后状态不得被偷偷修改');
      assert.strictEqual(stored?.completedAt, undefined);
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });
}
