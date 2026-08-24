// Backend 硬删除行程闭环：creator-only 授权、彻底移除、roomCode 失效、重启持久化与隔离性测试。

import assert from 'assert';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import express from 'express';
import { errorHandler, notFoundHandler } from '../src/middleware/error-handler';
import { JsonTripRepository } from '../src/repositories/json-trip-repository';
import { tripRouter } from '../src/routes/trips';
import { HmacTokenService } from '../src/services/token-service';
import { RealTripService } from '../src/services/trip-service';
import { AppError } from '../src/types/errors';
import { Trip } from '../src/types/trip';
import { record } from './run-tests';

function temporaryStore(): { directory: string; file: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cotrip-trip-delete-'));
  return { directory, file: path.join(directory, 'trips.json') };
}

function fixture(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip_delete',
    title: '顺德一日游',
    status: 'ACTIVE',
    creatorId: 'user_A',
    participantIds: ['user_A', 'user_B'],
    createdAt: '2026-08-24T10:00:00.000Z',
    roomCode: 'ABCDEFG',
    initialBrief: '去顺德吃东西',
    commentIds: ['cmt_1'],
    constraintIds: ['cst_1'],
    ...overrides,
  };
}

interface JsonResponse {
  status: number;
  body: Record<string, unknown>;
}

async function startTestServer(
  service: RealTripService,
  tokens: HmacTokenService,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use('/trips', tripRouter(service, tokens));
  app.use(notFoundHandler);
  app.use(errorHandler);

  const server = await new Promise<http.Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('测试服务器未获得 TCP 端口');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

async function requestJson(
  baseUrl: string,
  requestPath: string,
  init?: RequestInit,
): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}${requestPath}`, init);
  const raw = await response.text();
  return {
    status: response.status,
    body: raw ? JSON.parse(raw) as Record<string, unknown> : {},
  };
}

function errorCode(response: JsonResponse): string | undefined {
  const error = response.body.error as { code?: string } | undefined;
  return error?.code;
}

export async function runTripDeleteTests(): Promise<void> {
  await record('deleteTrip: creator 硬删除成功，存储中彻底移除且其他字段无从恢复', async () => {
    const temp = temporaryStore();
    try {
      const repo = new JsonTripRepository(temp.file);
      await repo.create(fixture());
      const service = new RealTripService(repo);

      await service.deleteTrip('user_A', 'trip_delete');

      assert.strictEqual(await repo.findById('trip_delete'), null);
      // 原子持久化：落盘文件中同样不存在该行程（含 id 字符串本身）
      assert.ok(!fs.readFileSync(temp.file, 'utf8').includes('trip_delete'));
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('deleteTrip: participant（非 creator）返回 403 且行程原样保留', async () => {
    const temp = temporaryStore();
    try {
      const base = fixture();
      const repo = new JsonTripRepository(temp.file);
      await repo.create(base);
      const service = new RealTripService(repo);

      await assert.rejects(
        () => service.deleteTrip('user_B', 'trip_delete'),
        (error: AppError) => error.status === 403 && error.code === 'TRIP_FORBIDDEN',
      );
      assert.deepStrictEqual(await repo.findById('trip_delete'), base, '被拒绝后行程不得有任何变化');
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('deleteTrip: 无关用户返回 403，客户端 spoof creatorId 不能获得权限', async () => {
    const temp = temporaryStore();
    try {
      const base = fixture();
      const repo = new JsonTripRepository(temp.file);
      await repo.create(base);
      const service = new RealTripService(repo);

      // deleteTrip 签名只有 (userId, tripId)：调用方传入的任何身份都来自认证 token，
      // 此处验证即使以参与者身份重复调用也永远 403，不存在 body 决定权限的通道。
      for (const caller of ['user_B', 'user_X']) {
        await assert.rejects(
          () => service.deleteTrip(caller, 'trip_delete'),
          (error: AppError) => error.status === 403 && error.code === 'TRIP_FORBIDDEN',
        );
      }
      assert.deepStrictEqual(await repo.findById('trip_delete'), base);
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('deleteTrip: 行程不存在返回 404 TRIP_NOT_FOUND', async () => {
    const temp = temporaryStore();
    try {
      const service = new RealTripService(new JsonTripRepository(temp.file));
      await assert.rejects(
        () => service.deleteTrip('user_A', 'trip_missing'),
        (error: AppError) => error.status === 404 && error.code === 'TRIP_NOT_FOUND',
      );
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('deleteTrip: 删除后 getTrip / 双状态 list / roomCode preview 全部失效', async () => {
    const temp = temporaryStore();
    try {
      const repo = new JsonTripRepository(temp.file);
      await repo.create(fixture());
      const service = new RealTripService(repo);
      await service.deleteTrip('user_A', 'trip_delete');

      await assert.rejects(
        () => service.getTrip('user_A', 'trip_delete'),
        (error: AppError) => error.status === 404 && error.code === 'TRIP_NOT_FOUND',
      );
      assert.deepStrictEqual((await repo.listForUser('user_B')).map((t) => t.id), []);
      assert.deepStrictEqual((await repo.listForUser('user_B', 'ACTIVE')).map((t) => t.id), []);
      assert.deepStrictEqual((await repo.listForUser('user_B', 'COMPLETED')).map((t) => t.id), []);
      await assert.rejects(
        () => service.getJoinPreview('ABCDEFG'),
        (error: AppError) => error.status === 404 && error.code === 'TRIP_NOT_FOUND',
      );
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('deleteTrip: 重启（新 repository 实例）后仍不存在，roomCode 依旧失效', async () => {
    const temp = temporaryStore();
    try {
      const first = new JsonTripRepository(temp.file);
      await first.create(fixture());
      const service = new RealTripService(first);
      await service.deleteTrip('user_A', 'trip_delete');

      const restarted = new JsonTripRepository(temp.file);
      assert.strictEqual(await restarted.findById('trip_delete'), null);
      assert.strictEqual(await restarted.findByRoomCode('ABCDEFG'), null);
      assert.deepStrictEqual((await restarted.listForUser('user_A')).map((t) => t.id), []);

      const restartedService = new RealTripService(restarted);
      await assert.rejects(
        () => restartedService.getJoinPreview('ABCDEFG'),
        (error: AppError) => error.status === 404,
      );
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('deleteTrip: 删除 A 不影响其他 Trip（数据、列表与 roomCode 完整保留）', async () => {
    const temp = temporaryStore();
    try {
      const other = fixture({ id: 'trip_keep', roomCode: 'HJKMNPQ', createdAt: '2026-08-23T10:00:00.000Z' });
      const repo = new JsonTripRepository(temp.file);
      await repo.create(fixture());
      await repo.create(other);
      const service = new RealTripService(repo);

      await service.deleteTrip('user_A', 'trip_delete');

      assert.deepStrictEqual(await repo.findById('trip_keep'), other);
      assert.deepStrictEqual((await repo.listForUser('user_B', 'ACTIVE')).map((t) => t.id), ['trip_keep']);
      const preview = await service.getJoinPreview('HJKMNPQ');
      assert.strictEqual(preview.title, '顺德一日游');
      assert.ok(!fs.readFileSync(temp.file, 'utf8').includes('trip_delete'), '被删行程不得残留在落盘文件中');
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('delete HTTP: 未认证 401；participant 403 且 spoof body 无法提权', async () => {
    const temp = temporaryStore();
    let close: (() => Promise<void>) | undefined;
    try {
      const base = fixture();
      const repo = new JsonTripRepository(temp.file);
      await repo.create(base);
      const service = new RealTripService(repo);
      const tokens = new HmacTokenService('delete-test-secret');
      const server = await startTestServer(service, tokens);
      close = server.close;

      // 未认证：无 Bearer token → 401
      const noAuth = await requestJson(server.baseUrl, '/trips/trip_delete', { method: 'DELETE' });
      assert.strictEqual(noAuth.status, 401);
      assert.strictEqual(errorCode(noAuth), 'AUTH_UNAUTHORIZED');
      assert.deepStrictEqual(await repo.findById('trip_delete'), base, '未认证请求不得改动数据');

      // participant 携带 spoof 身份字段（userId/creatorId 自称 creator）→ 仍然 403
      const spoofed = await requestJson(server.baseUrl, '/trips/trip_delete', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${tokens.sign('user_B')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId: 'user_A', creatorId: 'user_A' }),
      });
      assert.strictEqual(spoofed.status, 403);
      assert.strictEqual(errorCode(spoofed), 'TRIP_FORBIDDEN');
      assert.deepStrictEqual(await repo.findById('trip_delete'), base, '403 后行程必须原样保留');
    } finally {
      if (close) await close();
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('delete HTTP: creator 删除成功返回 ok；之后 GET/list/preview 均 404', async () => {
    const temp = temporaryStore();
    let close: (() => Promise<void>) | undefined;
    try {
      const repo = new JsonTripRepository(temp.file);
      await repo.create(fixture());
      const service = new RealTripService(repo);
      const tokens = new HmacTokenService('delete-test-secret');
      const server = await startTestServer(service, tokens);
      close = server.close;
      const authHeaders = { Authorization: `Bearer ${tokens.sign('user_A')}` };

      const deleted = await requestJson(server.baseUrl, '/trips/trip_delete', {
        method: 'DELETE',
        headers: authHeaders,
      });
      assert.strictEqual(deleted.status, 200);
      assert.deepStrictEqual(deleted.body, { ok: true });

      const afterDeleteGet = await requestJson(server.baseUrl, '/trips/trip_delete', {
        method: 'GET',
        headers: authHeaders,
      });
      assert.strictEqual(afterDeleteGet.status, 404);

      const afterDeleteList = await requestJson(
        server.baseUrl,
        '/trips?status=ACTIVE',
        { method: 'GET', headers: authHeaders },
      );
      assert.deepStrictEqual(afterDeleteList.body.trips, []);

      const afterDeletePreview = await requestJson(
        server.baseUrl,
        '/trips/join-preview?roomCode=ABCDEFG',
      );
      assert.strictEqual(afterDeletePreview.status, 404);

      const repeatDelete = await requestJson(server.baseUrl, '/trips/trip_delete', {
        method: 'DELETE',
        headers: authHeaders,
      });
      assert.strictEqual(repeatDelete.status, 404, '重复删除同一行程应幂等失败为 404');
    } finally {
      if (close) await close();
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });
}
