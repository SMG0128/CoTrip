// JSON Trip 仓库：使用原子替换写入，重启后仍保留 Trip shell。

import fs from 'fs';
import path from 'path';
import { TripRepository } from './trip-repository';
import { Trip, TripStatus } from '../types/trip';
import { AppError } from '../types/errors';

interface Store {
  trips: Trip[];
}

export class JsonTripRepository implements TripRepository {
  private readonly file: string;
  private store: Store;

  constructor(file: string) {
    this.file = file;
    this.store = this.load();
  }

  async create(trip: Trip): Promise<Trip> {
    const nextStore = { trips: [...this.store.trips, trip] };
    this.save(nextStore);
    this.store = nextStore;
    return trip;
  }

  async findById(id: string): Promise<Trip | null> {
    return this.store.trips.find((trip) => trip.id === id) ?? null;
  }

  async listForUser(userId: string, status?: TripStatus): Promise<Trip[]> {
    return this.store.trips
      .filter(
        (trip) => trip.participantIds.includes(userId) && (!status || trip.status === status),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
