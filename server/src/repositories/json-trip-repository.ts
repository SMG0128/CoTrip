// JSON Trip 仓库：使用原子替换写入，重启后仍保留 Trip shell。

import fs from 'fs';
import path from 'path';
import { TripRepository } from './trip-repository';
import { Trip, TripStatus } from '../types/trip';
import { AppError } from '../types/errors';
import { generateRoomCode, isValidRoomCode } from '../utils/room-code';

interface Store {
  trips: Trip[];
}

export class JsonTripRepository implements TripRepository {
  private readonly file: string;
  private store: Store;

  constructor(file: string) {
    this.file = file;
    const loaded = this.load();
    const migrated = this.migrate(loaded);
    this.store = migrated.store;
    if (migrated.backfilled > 0) {
      // 安全迁移：仅补 roomCode，不重建、不覆盖其它字段；写失败沿用 TRIP_PERSISTENCE_FAILURE。
      this.save(this.store);
      console.log(`[room-code] backfilled ${migrated.backfilled} legacy trip(s)`);
    }
  }

  async create(trip: Trip): Promise<Trip> {
    if (this.store.trips.some((existing) => existing.id === trip.id)) {
      throw new AppError(500, 'TRIP_PERSISTENCE_FAILURE', '行程数据保存失败');
    }
    if (this.store.trips.some((existing) => existing.roomCode === trip.roomCode)) {
      // service 捕获后重新生成；唯一性必须在提交点再次校验，避免并发“先查后写”竞态。
      throw new AppError(409, 'ROOM_CODE_CONFLICT', '房间号冲突');
    }
    const nextStore = { trips: [...this.store.trips, trip] };
    this.save(nextStore);
    this.store = nextStore;
    return trip;
  }

  /** 按 id 整体替换该 Trip；与 create 共用原子 save 与失败语义（TRIP_PERSISTENCE_FAILURE）。 */
  async update(trip: Trip): Promise<Trip> {
    const exists = this.store.trips.some((existing) => existing.id === trip.id);
    if (!exists) {
      throw new AppError(404, 'TRIP_NOT_FOUND', '行程不存在');
    }
    const nextStore = {
      trips: this.store.trips.map((existing) => (existing.id === trip.id ? trip : existing)),
    };
    this.save(nextStore);
    this.store = nextStore;
    return trip;
  }

  async findById(id: string): Promise<Trip | null> {
    return this.store.trips.find((trip) => trip.id === id) ?? null;
  }

  async findByRoomCode(roomCode: string): Promise<Trip | null> {
    if (!isValidRoomCode(roomCode)) {
      return null;
    }
    return this.store.trips.find((trip) => trip.roomCode === roomCode) ?? null;
  }

  async addParticipant(tripId: string, userId: string): Promise<Trip> {
    const trip = this.store.trips.find((candidate) => candidate.id === tripId);
    if (!trip) {
      throw new AppError(404, 'TRIP_NOT_FOUND', '行程不存在');
    }
    if (trip.participantIds.includes(userId)) {
      return trip;
    }

    const updated: Trip = {
      ...trip,
      participantIds: [...trip.participantIds, userId],
    };
    const nextStore = {
      trips: this.store.trips.map((candidate) =>
        candidate.id === tripId ? updated : candidate,
      ),
    };
    this.save(nextStore);
    this.store = nextStore;
    return updated;
  }

  /** 硬删除：与 create/update 共用原子 save 与失败语义；只移除目标 Trip，其余原样保留。 */
  async remove(tripId: string): Promise<void> {
    const exists = this.store.trips.some((existing) => existing.id === tripId);
    if (!exists) {
      throw new AppError(404, 'TRIP_NOT_FOUND', '行程不存在');
    }
    const nextStore = { trips: this.store.trips.filter((existing) => existing.id !== tripId) };
    this.save(nextStore);
    this.store = nextStore;
  }

  async backfillRoomCodes(): Promise<number> {
    const migrated = this.migrate(this.store);
    this.store = migrated.store;
    if (migrated.backfilled > 0) {
      this.save(this.store);
    }
    return migrated.backfilled;
  }

  async listForUser(userId: string, status?: TripStatus): Promise<Trip[]> {
    return this.store.trips
      .filter(
        (trip) => trip.participantIds.includes(userId) && (!status || trip.status === status),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * V0.3 迁移：为缺失 / 非法 roomCode 的 Trip 生成唯一房间号。
   * 保留原 id / creatorId / participantIds / createdAt 及其它全部字段，只补 roomCode。
   */
  private migrate(store: Store): { store: Store; backfilled: number } {
    const used = new Set<string>();
    let backfilled = 0;
    const trips = store.trips.map((trip) => {
      if (isValidRoomCode(trip.roomCode) && !used.has(trip.roomCode)) {
        used.add(trip.roomCode);
        return trip;
      }
      const code = this.generateUnusedRoomCode(used);
      used.add(code);
      backfilled++;
      return { ...trip, roomCode: code };
    });
    return { store: { trips }, backfilled };
  }

  private generateUnusedRoomCode(used: Set<string>): string {
    for (let attempt = 0; attempt < 100; attempt++) {
      const code = generateRoomCode();
      if (!used.has(code)) return code;
    }
    throw new AppError(500, 'ROOM_CODE_GENERATION_FAILED', '房间号生成失败，请重试');
  }

  private load(): Store {
    if (!fs.existsSync(this.file)) {
      return { trips: [] };
    }

    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw) as { trips?: unknown };
      if (!Array.isArray(parsed.trips)) {
        throw new Error('invalid trip store');
      }
      return { trips: parsed.trips as Trip[] };
    } catch {
      throw new AppError(500, 'TRIP_PERSISTENCE_FAILURE', '行程数据读取失败');
    }
  }

  private save(store: Store): void {
    const directory = path.dirname(this.file);
    const temporaryFile = `${this.file}.tmp`;
    try {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(temporaryFile, JSON.stringify(store, null, 2), 'utf8');
      fs.renameSync(temporaryFile, this.file);
    } catch {
      try {
        fs.rmSync(temporaryFile, { force: true });
      } catch {
        // 保留原始写入错误；清理临时文件失败不得泄露路径。
      }
      throw new AppError(500, 'TRIP_PERSISTENCE_FAILURE', '行程数据保存失败');
    }
  }
}
