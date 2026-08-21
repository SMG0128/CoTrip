// Trip 业务层：服务器拥有身份、ID、时间戳和权限决策。

import crypto from 'crypto';
import { TripRepository } from '../repositories/trip-repository';
import { CreateTripInput, Trip, TripStatus } from '../types/trip';
import { AppError } from '../types/errors';
import { generateRoomCode } from '../utils/room-code';

export interface TripService {
  createTrip(authenticatedUserId: string, input: CreateTripInput): Promise<Trip>;
  listTrips(userId: string, status?: TripStatus): Promise<Trip[]>;
  getTrip(userId: string, tripId: string): Promise<Trip>;
}

export class RealTripService implements TripService {
  constructor(
    private readonly trips: TripRepository,
    private readonly random: () => number = Math.random,
  ) {}

  /** 服务器生成房间号；与已有 roomCode 碰撞时重新生成（上限 50 次）。 */
  private async generateUniqueRoomCode(): Promise<string> {
    for (let attempt = 0; attempt < 50; attempt++) {
      const code = generateRoomCode(this.random);
      if (!(await this.trips.findByRoomCode(code))) {
        return code;
      }
    }
    throw new AppError(500, 'ROOM_CODE_GENERATION_FAILED', '房间号生成失败，请重试');
  }

  async createTrip(authenticatedUserId: string, input: CreateTripInput): Promise<Trip> {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const initialBrief =
      typeof input.initialBrief === 'string' ? input.initialBrief.trim() : '';
    if (!title || title.length > 100) {
      throw new AppError(400, 'VALIDATION_ERROR', '行程标题长度需在 1-100 个字符之间');
    }
    if (initialBrief.length > 2000) {
      throw new AppError(400, 'VALIDATION_ERROR', '行程简述不能超过 2000 个字符');
    }

    const trip: Trip = {
      id: `trip_${crypto.randomUUID()}`,
      title,
      status: 'ACTIVE',
      creatorId: authenticatedUserId,
      participantIds: [authenticatedUserId],
      createdAt: new Date().toISOString(),
      roomCode: await this.generateUniqueRoomCode(),
      initialBrief,
      areaConstraint: input.areaConstraint,
      timeRange: input.timeRange,
      commentIds: [],
      constraintIds: [],
    };

    return this.trips.create(trip);
  }

  async listTrips(userId: string, status?: TripStatus): Promise<Trip[]> {
    return this.trips.listForUser(userId, status);
  }

  async getTrip(userId: string, tripId: string): Promise<Trip> {
    const trip = await this.trips.findById(tripId);
    if (!trip) {
      throw new AppError(404, 'TRIP_NOT_FOUND', '行程不存在');
    }
    if (!trip.participantIds.includes(userId)) {
      throw new AppError(403, 'TRIP_FORBIDDEN', '无权访问该行程');
    }
    return trip;
  }
}
