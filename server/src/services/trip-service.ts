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
  completeTrip(authenticatedUserId: string, tripId: string): Promise<Trip>;
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

  /** 完成行程：仅 creator 可操作；COMPLETED 幂等返回；DRAFT/CANCELLED 拒绝且绝不偷偷改状态。 */
  async completeTrip(authenticatedUserId: string, tripId: string): Promise<Trip> {
    const trip = await this.trips.findById(tripId);
    if (!trip) {
      throw new AppError(404, 'TRIP_NOT_FOUND', '行程不存在');
    }
    // 身份只来自认证 token；非 creator 的 participant 同样无权完成行程。
    if (authenticatedUserId !== trip.creatorId) {
      throw new AppError(403, 'TRIP_FORBIDDEN', '仅行程发起人可完成行程');
    }
    if (trip.status === 'COMPLETED') {
      // 幂等：已完成直接返回现有快照，不重置 completedAt、不落盘。
      return trip;
    }
    if (trip.status !== 'ACTIVE') {
      // DRAFT / CANCELLED 不允许完成；显式冲突交给调用方处理。
      throw new AppError(409, 'TRIP_INVALID_STATUS_TRANSITION', '当前状态不允许完成行程');
    }
    const completedTrip: Trip = {
      ...trip,
      status: 'COMPLETED',
      completedAt: new Date().toISOString(),
    };
    return this.trips.update(completedTrip);
  }
}
