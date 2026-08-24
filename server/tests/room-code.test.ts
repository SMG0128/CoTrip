// Backend V0.3 Room Identity 测试：
// - createTrip 生成合法房间号
// - 房间号全局唯一
// - 碰撞时重新生成（确定性注入随机源）
// - findByRoomCode 基础查询
// - 历史 Trip backfill：只补缺失 roomCode，保留原字段，持久化，且幂等

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { JsonTripRepository } from '../src/repositories/json-trip-repository';
import { TripRepository } from '../src/repositories/trip-repository';
import { RealTripService } from '../src/services/trip-service';
import { Trip, TripStatus } from '../src/types/trip';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, isValidRoomCode } from '../src/utils/room-code';
import { record } from './run-tests';

function temporaryStore(): { directory: string; file: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cotrip-room-'));
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

function assertValidRoomCode(code: string): void {
  assert.strictEqual(typeof code, 'string');
  assert.strictEqual(code.length, ROOM_CODE_LENGTH, `roomCode 长度必须为 ${ROOM_CODE_LENGTH}`);
  for (const ch of code) {
    assert.ok(
      ROOM_CODE_ALPHABET.includes(ch),
      `roomCode 含非法字符 ${ch}（排除 0/O/1/I/L）`
    );
  }
}

/** 记录 findByRoomCode 调用次数的桩仓库，用于确定性碰撞测试。 */
class CollisionOnceRepo implements TripRepository {
  calls = 0;
  async create(trip: Trip): Promise<Trip> {
    return trip;
  }
  async update(_trip: Trip): Promise<Trip> {
    // 该桩仅覆盖房间号生成路径，update 不应被调用。
    throw new Error('CollisionOnceRepo 不支持 update');
  }
  async findById(_id: string): Promise<Trip | null> {
    return null;
  }
  async findByRoomCode(code: string): Promise<Trip | null> {
    this.calls++;
    // 第一次视为「已存在」（模拟碰撞），之后视为空闲。
    return this.calls === 1 ? fixture({ roomCode: code }) : null;
  }
  async addParticipant(_tripId: string, _userId: string): Promise<Trip> {
    // 该桩仅覆盖房间号生成路径，join 不应被调用。
    throw new Error('CollisionOnceRepo 不支持 addParticipant');
  }
  async remove(_tripId: string): Promise<void> {
    // 该桩仅覆盖房间号生成路径，删除不应被调用。
    throw new Error('CollisionOnceRepo 不支持 remove');
  }
  async backfillRoomCodes(): Promise<number> {
    return 0;
  }
  async listForUser(_userId: string, _status?: TripStatus): Promise<Trip[]> {
    return [];
  }
}

export async function runRoomCodeTests(): Promise<void> {
  await record('room code: createTrip 生成 7 位且仅含白名单字符', async () => {
    const temp = temporaryStore();
    try {
      const service = new RealTripService(new JsonTripRepository(temp.file));
      const trip = await service.createTrip('usr_123', {
        title: '房间号测试',
        initialBrief: '',
      });
      assert.ok(trip.roomCode, 'createTrip 必须生成 roomCode');
      assertValidRoomCode(trip.roomCode);
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('room code: 大量创建仍保持全局唯一', async () => {
    const temp = temporaryStore();
    try {
      const service = new RealTripService(new JsonTripRepository(temp.file));
      const codes = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const trip = await service.createTrip('usr_123', { title: `行程 ${i}`, initialBrief: '' });
        assertValidRoomCode(trip.roomCode);
        codes.add(trip.roomCode);
      }
      assert.strictEqual(codes.size, 100, '100 个 Trip 的 roomCode 必须两两不同');
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('room code: 并发创建在提交点碰撞后重试并保持唯一', async () => {
    const temp = temporaryStore();
    try {
      const repo = new JsonTripRepository(temp.file);
      let calls = 0;
      // 两个请求首次都生成 AAAAAAA；提交冲突的一方随后生成 DDDDDDD。
      const rng = () => (calls++ < ROOM_CODE_LENGTH * 2 ? 0 : 0.1);
      const service = new RealTripService(repo, rng);
      const [first, second] = await Promise.all([
        service.createTrip('usr_123', { title: '并发行程 A', initialBrief: '' }),
        service.createTrip('usr_456', { title: '并发行程 B', initialBrief: '' }),
      ]);

      assert.notStrictEqual(first.roomCode, second.roomCode);
      assert.deepStrictEqual(
        new Set([first.roomCode, second.roomCode]),
        new Set(['AAAAAAA', 'DDDDDDD']),
      );
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('room code: 碰撞时重新生成（确定性注入随机源）', async () => {
    const repo = new CollisionOnceRepo();
    let calls = 0;
    // 前 7 次调用恒为 0（生成 AAAAAAA），后 7 次恒为 0.1（生成 DDDDDDD）。
    const rng = () => (calls++ < ROOM_CODE_LENGTH ? 0 : 0.1);
    const service = new RealTripService(repo, rng);
    const trip = await service.createTrip('usr_123', { title: '碰撞重试', initialBrief: '' });
    assert.strictEqual(repo.calls, 2, '首次碰撞后必须重新生成');
    assert.notStrictEqual(trip.roomCode, 'AAAAAAA', '重试后不得继续使用被占用的房间号');
    assert.strictEqual(trip.roomCode, 'DDDDDDD');
    assertValidRoomCode(trip.roomCode);
  });

  await record('room code: findByRoomCode 返回正确 Trip，非法码返回 null', async () => {
    const temp = temporaryStore();
    try {
      const repo = new JsonTripRepository(temp.file);
      await repo.create(fixture({ id: 'trip_one', roomCode: 'K2M4P9Q' }));
      await repo.create(fixture({ id: 'trip_two', roomCode: '7K4M9XQ' }));
      const found = await repo.findByRoomCode('7K4M9XQ');
      assert.ok(found);
      assert.strictEqual(found.id, 'trip_two');
      assert.strictEqual(await repo.findByRoomCode('7K4M9X1'), null, '含 1 的非法码应返回 null');
      assert.strictEqual(await repo.findByRoomCode('not-a-code'), null);
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('room code: backfill 补齐缺失 roomCode 并保留原字段', async () => {
    const temp = temporaryStore();
    try {
      const legacy = [
        {
          id: 'legacy_a',
          title: '旧行程 A',
          status: 'ACTIVE' as const,
          creatorId: 'usr_old',
          participantIds: ['usr_old'],
          createdAt: '2026-08-01T00:00:00.000Z',
          initialBrief: '旧数据 A',
          commentIds: ['c1'],
          constraintIds: ['x1'],
        },
        {
          id: 'legacy_b',
          title: '旧行程 B',
          status: 'ACTIVE' as const,
          creatorId: 'usr_old',
          participantIds: ['usr_old'],
          createdAt: '2026-08-02T00:00:00.000Z',
          initialBrief: '旧数据 B',
          roomCode: '0XXXXXX',
          commentIds: [],
          constraintIds: [],
        },
        {
          id: 'legacy_c',
          title: '旧行程 C',
          status: 'COMPLETED' as const,
          creatorId: 'usr_old',
          participantIds: ['usr_old'],
          createdAt: '2026-08-03T00:00:00.000Z',
          initialBrief: '已有合法房间号',
          roomCode: 'K2M4P9Q',
          commentIds: [],
          constraintIds: [],
        },
        {
          id: 'legacy_duplicate',
          title: '重复房间号',
          status: 'ACTIVE' as const,
          creatorId: 'usr_old',
          participantIds: ['usr_old'],
          createdAt: '2026-08-04T00:00:00.000Z',
          initialBrief: '重复合法 roomCode 也必须修复',
          roomCode: 'K2M4P9Q',
          commentIds: [],
          constraintIds: [],
        },
      ];
      fs.writeFileSync(temp.file, JSON.stringify({ trips: legacy }, null, 2), 'utf8');

      const repo = new JsonTripRepository(temp.file);

      const a = await repo.findById('legacy_a');
      const b = await repo.findById('legacy_b');
      const c = await repo.findById('legacy_c');
      const duplicate = await repo.findById('legacy_duplicate');
      assert.ok(a && b && c && duplicate, 'backfill 不得丢 Trip');

      assertValidRoomCode(a.roomCode);
      assertValidRoomCode(b.roomCode);
      assert.notStrictEqual(b.roomCode, '0XXXXXX', '含 0 的非法 roomCode 必须被重新生成');
      assert.strictEqual(c.roomCode, 'K2M4P9Q', '已有合法 roomCode 不得被重新生成');
      assert.notStrictEqual(
        duplicate.roomCode,
        'K2M4P9Q',
        '重复的合法 roomCode 必须重新生成以恢复全局唯一性',
      );

      // 原字段全部保留
      assert.strictEqual(a.id, 'legacy_a');
      assert.strictEqual(a.title, '旧行程 A');
      assert.strictEqual(a.creatorId, 'usr_old');
      assert.deepStrictEqual(a.participantIds, ['usr_old']);
      assert.strictEqual(a.createdAt, '2026-08-01T00:00:00.000Z');
      assert.deepStrictEqual(a.commentIds, ['c1']);
      assert.deepStrictEqual(a.constraintIds, ['x1']);

      // 唯一性
      const codes = [a.roomCode, b.roomCode, c.roomCode, duplicate.roomCode];
      assert.strictEqual(new Set(codes).size, 4, 'backfill 后房间号必须唯一');

      // 已持久化
      const persisted = JSON.parse(fs.readFileSync(temp.file, 'utf8')) as { trips: Trip[] };
      assert.strictEqual(persisted.trips.length, 4);
      for (const trip of persisted.trips) {
        assert.ok(isValidRoomCode(trip.roomCode), '持久化文件中的 Trip 必须全部拥有合法 roomCode');
      }

      // 幂等：重新加载不得再变更
      const again = new JsonTripRepository(temp.file);
      assert.strictEqual((await again.findById('legacy_a'))?.roomCode, a.roomCode);
      assert.strictEqual((await again.findById('legacy_c'))?.roomCode, 'K2M4P9Q');
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });
}
