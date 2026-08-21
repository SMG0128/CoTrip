// Backend V0.2 Trip shell 持久化、身份与权限测试。

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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cotrip-trips-'));
  return { directory, file: path.join(directory, 'trips.json') };
}

function fixture(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip_fixture',
    title: 'Fixture Trip',
    status: 'ACTIVE',
    creatorId: 'usr_123',
    participantIds: ['usr_123'],
    createdAt: '2026-08-20T10:00:00.000Z',
    roomCode: 'ABCDEFG',
    initialBrief: 'fixture',
    commentIds: [],
    constraintIds: [],
    ...overrides,
  };
}

export async function runTripTests(): Promise<void> {
  await record('trip repository: 新实例可读取已创建 Trip（重启持久化）', async () => {
    const temp = temporaryStore();
    try {
      const first = new JsonTripRepository(temp.file);
      await first.create(fixture());
      const restarted = new JsonTripRepository(temp.file);
      assert.deepStrictEqual(await restarted.findById('trip_fixture'), fixture());
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('trip service: creator 与默认 participant 只来自认证 userId', async () => {
    const temp = temporaryStore();
    try {
      const service = new RealTripService(new JsonTripRepository(temp.file));
      const trip = await service.createTrip('usr_123', {
        title: '顺德一日游',
        initialBrief: '周末去顺德吃东西',
      });
      assert.strictEqual(trip.creatorId, 'usr_123');
      assert.deepStrictEqual(trip.participantIds, ['usr_123']);
      assert.strictEqual(trip.status, 'ACTIVE');
      assert.ok(trip.id.startsWith('trip_'));
      assert.ok(trip.roomCode, 'createTrip 必须生成 roomCode');
      assert.strictEqual(trip.roomCode.length, 7, 'roomCode 长度必须为 7');
      assert.deepStrictEqual(trip.commentIds, []);
      assert.deepStrictEqual(trip.constraintIds, []);
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('trip service: 客户端 spoof 字段不能覆盖服务器身份与状态', async () => {
    const temp = temporaryStore();
    try {
      const service = new RealTripService(new JsonTripRepository(temp.file));
      const spoofedInput = {
        title: '安全行程',
        initialBrief: '',
        creatorId: 'usr_999',
        participantIds: ['usr_999'],
        status: 'COMPLETED',
        id: 'trip_attacker',
      };
      const trip = await service.createTrip('usr_123', spoofedInput);
      assert.strictEqual(trip.creatorId, 'usr_123');
      assert.deepStrictEqual(trip.participantIds, ['usr_123']);
      assert.strictEqual(trip.status, 'ACTIVE');
      assert.notStrictEqual(trip.id, 'trip_attacker');
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('trip repository: list mine 使用 participantIds、支持状态并按时间倒序', async () => {
    const temp = temporaryStore();
    try {
      const repo = new JsonTripRepository(temp.file);
      await repo.create(fixture({ id: 'mine_old', creatorId: 'other', participantIds: ['usr_123'], createdAt: '2026-08-19T00:00:00.000Z' }));
      await repo.create(fixture({ id: 'not_mine', creatorId: 'usr_456', participantIds: ['usr_456'], createdAt: '2026-08-21T00:00:00.000Z' }));
      await repo.create(fixture({ id: 'mine_new', creatorId: 'other', participantIds: ['other', 'usr_123'], createdAt: '2026-08-20T00:00:00.000Z' }));
      await repo.create(fixture({ id: 'mine_done', participantIds: ['usr_123'], status: 'COMPLETED', createdAt: '2026-08-22T00:00:00.000Z' }));
      assert.deepStrictEqual((await repo.listForUser('usr_123', 'ACTIVE')).map((trip) => trip.id), ['mine_new', 'mine_old']);
      assert.deepStrictEqual((await repo.listForUser('usr_123', 'COMPLETED')).map((trip) => trip.id), ['mine_done']);
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('trip service: 非 participant 读取其他用户 Trip 返回 TRIP_FORBIDDEN', async () => {
    const temp = temporaryStore();
    try {
      const repo = new JsonTripRepository(temp.file);
      await repo.create(fixture());
      const service = new RealTripService(repo);
      await assert.rejects(
        () => service.getTrip('usr_456', 'trip_fixture'),
        (error: AppError) => error.status === 403 && error.code === 'TRIP_FORBIDDEN',
      );
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('trip repository: 损坏 JSON 明确失败且不会被静默清空', () => {
    const temp = temporaryStore();
    try {
      fs.writeFileSync(temp.file, '{broken json', 'utf8');
      assert.throws(
        () => new JsonTripRepository(temp.file),
        (error: AppError) => error.code === 'TRIP_PERSISTENCE_FAILURE',
      );
      assert.strictEqual(fs.readFileSync(temp.file, 'utf8'), '{broken json');
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });
}
