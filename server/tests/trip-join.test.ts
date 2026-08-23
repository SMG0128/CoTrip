// Real multi-user join 本地闭环：公开最小预览、Bearer 身份加入、幂等与 JSON 持久化。

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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cotrip-trip-join-'));
  return { directory, file: path.join(directory, 'trips.json') };
}

function fixture(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip_join',
    title: '顺德一日游',
    status: 'ACTIVE',
    creatorId: 'user_A',
    participantIds: ['user_A'],
    createdAt: '2026-08-24T10:00:00.000Z',
    roomCode: 'ABCDEFG',
    initialBrief: '去顺德吃东西',
    areaConstraint: { district: '顺德区', privateCoordinate: 'hidden' },
    timeRange: { start: '2026-08-25T09:00:00+08:00' },
    currentPlan: { internal: true },
    commentIds: ['comment_private'],
    constraintIds: ['constraint_private'],
    ...overrides,
  };
}

interface JsonResponse {
  status: number;
  body: Record<string, unknown>;
  raw: string;
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
    raw,
  };
}

function errorCode(response: JsonResponse): string | undefined {
  const error = response.body.error as { code?: string } | undefined;
  return error?.code;
}

export async function runTripJoinTests(): Promise<void> {
  await record('join preview: 规范化 roomCode 且只返回四个公开字段', async () => {
    const temp = temporaryStore();
    try {
      const repo = new JsonTripRepository(temp.file);
      await repo.create(fixture());
      const service = new RealTripService(repo);

      const preview = await service.getJoinPreview(' ab c\tdefg ');
      assert.deepStrictEqual(preview, {
        roomCode: 'ABCDEFG',
        title: '顺德一日游',
        participantCount: 1,
        status: 'ACTIVE',
      });
      assert.deepStrictEqual(
        Object.keys(preview).sort(),
        ['participantCount', 'roomCode', 'status', 'title'],
      );
      assert.ok(!('participantIds' in preview));
      assert.ok(!('creatorId' in preview));
      assert.ok(!('openid' in preview));
      assert.ok(!('wechatOpenId' in preview));
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('join service: A 创建、B/C 加入、B 重复加入幂等且 creator 不变', async () => {
    const temp = temporaryStore();
    try {
      const repo = new JsonTripRepository(temp.file);
      await repo.create(fixture());
      const service = new RealTripService(repo);

      const joinedByB = await service.joinTrip('user_B', 'abcdefg');
      assert.deepStrictEqual(joinedByB.participantIds, ['user_A', 'user_B']);
      assert.strictEqual(joinedByB.creatorId, 'user_A');

      const joinedByC = await service.joinTrip('user_C', ' ABC DEFG ');
      assert.deepStrictEqual(joinedByC.participantIds, ['user_A', 'user_B', 'user_C']);
      assert.strictEqual(joinedByC.creatorId, 'user_A');

      const duplicateB = await service.joinTrip('user_B', 'ABCDEFG');
      assert.deepStrictEqual(duplicateB.participantIds, ['user_A', 'user_B', 'user_C']);
      assert.strictEqual(
        duplicateB.participantIds.filter((id) => id === 'user_B').length,
        1,
      );
      assert.strictEqual(duplicateB.creatorId, 'user_A', 'join 永远不能转移 creator');

      const preview = await service.getJoinPreview('ABCDEFG');
      assert.strictEqual(preview.participantCount, 3);

      const restarted = new JsonTripRepository(temp.file);
      const persisted = await restarted.findById('trip_join');
      assert.deepStrictEqual(persisted?.participantIds, ['user_A', 'user_B', 'user_C']);
      assert.strictEqual(persisted?.creatorId, 'user_A');
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('join service: invalid / missing / non-ACTIVE 分别返回 400 / 404 / 409', async () => {
    const temp = temporaryStore();
    try {
      const repo = new JsonTripRepository(temp.file);
      await repo.create(fixture());
      await repo.create(fixture({
        id: 'trip_completed',
        roomCode: 'QRSTUVW',
        status: 'COMPLETED',
      }));
      await repo.create(fixture({
        id: 'trip_draft',
        roomCode: 'HJKMNPQ',
        status: 'DRAFT',
      }));
      await repo.create(fixture({
        id: 'trip_cancelled',
        roomCode: '2345678',
        status: 'CANCELLED',
      }));
      const service = new RealTripService(repo);

      await assert.rejects(
        () => service.getJoinPreview('bad'),
        (error: AppError) =>
          error.status === 400 && error.code === 'TRIP_INVALID_ROOM_CODE',
      );
      await assert.rejects(
        () => service.joinTrip('user_B', 'ZXCVBNM'),
        (error: AppError) => error.status === 404 && error.code === 'TRIP_NOT_FOUND',
      );
      for (const [roomCode, tripId] of [
        ['QRSTUVW', 'trip_completed'],
        ['HJKMNPQ', 'trip_draft'],
        ['2345678', 'trip_cancelled'],
      ]) {
        await assert.rejects(
          () => service.joinTrip('user_B', roomCode),
          (error: AppError) => error.status === 409 && error.code === 'TRIP_NOT_JOINABLE',
        );
        assert.deepStrictEqual(
          (await repo.findById(tripId))?.participantIds,
          ['user_A'],
          `${tripId} 不可加入时不得写 participantIds`,
        );
      }
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('join HTTP: preview 公开、POST 必须 Bearer，且 body 不能 spoof 身份', async () => {
    const temp = temporaryStore();
    let close: (() => Promise<void>) | undefined;
    try {
      const repo = new JsonTripRepository(temp.file);
      await repo.create(fixture());
      const service = new RealTripService(repo);
      const tokens = new HmacTokenService('join-test-secret');
      const server = await startTestServer(service, tokens);
      close = server.close;

      const previewResponse = await requestJson(
        server.baseUrl,
        '/trips/join-preview?roomCode=%20ab%20cdefg%20',
      );
      assert.strictEqual(previewResponse.status, 200, 'preview 不要求认证');
      assert.deepStrictEqual(Object.keys(previewResponse.body), ['preview']);
      assert.deepStrictEqual(previewResponse.body.preview, {
        roomCode: 'ABCDEFG',
        title: '顺德一日游',
        participantCount: 1,
        status: 'ACTIVE',
      });
      for (const privateField of [
        'participantIds',
        'creatorId',
        'openid',
        'wechatOpenId',
        'initialBrief',
        'currentPlan',
      ]) {
        assert.ok(!previewResponse.raw.includes(privateField), `preview 不得泄露 ${privateField}`);
      }

      const noAuth = await requestJson(server.baseUrl, '/trips/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode: 'ABCDEFG' }),
      });
      assert.strictEqual(noAuth.status, 401);
      assert.strictEqual(errorCode(noAuth), 'AUTH_UNAUTHORIZED');

      const joinAsB = await requestJson(server.baseUrl, '/trips/join', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.sign('user_B')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          roomCode: 'abcdefg',
          userId: 'attacker',
          participantId: 'attacker',
          participantIds: ['attacker'],
          creatorId: 'attacker',
        }),
      });
      assert.strictEqual(joinAsB.status, 200);
      const joinedTrip = (joinAsB.body.trip ?? {}) as Trip;
      assert.deepStrictEqual(joinedTrip.participantIds, ['user_A', 'user_B']);
      assert.ok(!joinedTrip.participantIds.includes('attacker'));
      assert.strictEqual(joinedTrip.creatorId, 'user_A');

      const duplicateB = await requestJson(server.baseUrl, '/trips/join', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.sign('user_B')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ roomCode: 'ABCDEFG' }),
      });
      assert.strictEqual(duplicateB.status, 200);
      assert.deepStrictEqual((duplicateB.body.trip as Trip).participantIds, ['user_A', 'user_B']);

      const joinAsC = await requestJson(server.baseUrl, '/trips/join', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.sign('user_C')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ roomCode: ' A B C D E F G ' }),
      });
      assert.strictEqual(joinAsC.status, 200);
      assert.deepStrictEqual(
        (joinAsC.body.trip as Trip).participantIds,
        ['user_A', 'user_B', 'user_C'],
      );
    } finally {
      if (close) await close();
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('join HTTP: invalid / missing / non-ACTIVE 映射稳定错误状态', async () => {
    const temp = temporaryStore();
    let close: (() => Promise<void>) | undefined;
    try {
      const repo = new JsonTripRepository(temp.file);
      await repo.create(fixture());
      await repo.create(fixture({
        id: 'trip_completed',
        roomCode: 'QRSTUVW',
        status: 'COMPLETED',
      }));
      const tokens = new HmacTokenService('join-test-secret');
      const server = await startTestServer(new RealTripService(repo), tokens);
      close = server.close;
      const authHeaders = {
        Authorization: `Bearer ${tokens.sign('user_B')}`,
        'Content-Type': 'application/json',
      };

      const invalidPreview = await requestJson(
        server.baseUrl,
        '/trips/join-preview?roomCode=bad',
      );
      assert.strictEqual(invalidPreview.status, 400);
      assert.strictEqual(errorCode(invalidPreview), 'TRIP_INVALID_ROOM_CODE');

      const missingPreview = await requestJson(
        server.baseUrl,
        '/trips/join-preview?roomCode=ZXCVBNM',
      );
      assert.strictEqual(missingPreview.status, 404);
      assert.strictEqual(errorCode(missingPreview), 'TRIP_NOT_FOUND');

      const invalidJoin = await requestJson(server.baseUrl, '/trips/join', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ roomCode: 'bad' }),
      });
      assert.strictEqual(invalidJoin.status, 400);
      assert.strictEqual(errorCode(invalidJoin), 'TRIP_INVALID_ROOM_CODE');

      const missingJoin = await requestJson(server.baseUrl, '/trips/join', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ roomCode: 'ZXCVBNM' }),
      });
      assert.strictEqual(missingJoin.status, 404);
      assert.strictEqual(errorCode(missingJoin), 'TRIP_NOT_FOUND');

      const completedJoin = await requestJson(server.baseUrl, '/trips/join', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ roomCode: 'QRSTUVW' }),
      });
      assert.strictEqual(completedJoin.status, 409);
      assert.strictEqual(errorCode(completedJoin), 'TRIP_NOT_JOINABLE');
    } finally {
      if (close) await close();
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });
}
