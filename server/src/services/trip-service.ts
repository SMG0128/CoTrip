// Trip 业务层：服务器拥有身份、ID、时间戳和权限决策。

import crypto from 'crypto';
import { TripRepository } from '../repositories/trip-repository';
import { CreateTripInput, Trip, TripJoinPreview, TripStatus } from '../types/trip';
import { AppError } from '../types/errors';
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from '../utils/room-code';
import {
  TripPreprocessAIService,
  UnavailableTripPreprocessAIService,
} from './trip-preprocess-ai-service';
import { buildTripAIContext, validatePreprocessEnvelope } from './trip-preprocess-ai-validation';
import { TripPreprocessTripInput } from '../types/ai-preprocess';

export interface TripService {
  createTrip(authenticatedUserId: string, input: CreateTripInput): Promise<Trip>;
  listTrips(userId: string, status?: TripStatus): Promise<Trip[]>;
  getTrip(userId: string, tripId: string): Promise<Trip>;
  getJoinPreview(roomCode: string): Promise<TripJoinPreview>;
  joinTrip(authenticatedUserId: string, roomCode: string): Promise<Trip>;
  completeTrip(authenticatedUserId: string, tripId: string): Promise<Trip>;
  deleteTrip(authenticatedUserId: string, tripId: string): Promise<void>;
}

export class RealTripService implements TripService {
  constructor(
    private readonly trips: TripRepository,
    private readonly random: () => number = Math.random,
    /** AI Trip Pipeline V2：创建行程时的第一次 AI 调用（PREPROCESS）；未配置时不阻塞创建 */
    private readonly preprocessAI: TripPreprocessAIService = new UnavailableTripPreprocessAIService(),
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

    // AI Trip Pipeline V2：创建行程时的第一次 AI 调用固定为 PREPROCESS。
    // 只做意图/约束预处理，绝不生成 itinerary；AI 不可用或响应非法时优雅降级
    // （行程照常创建、不写入 aiContext），绝不伪造 AI 分析。
    const tripInput: TripPreprocessTripInput = {
      title,
      initialBrief,
      areaConstraint: input.areaConstraint,
      timeRange: input.timeRange,
    };
    let aiContext: Trip['aiContext'];
    try {
      const envelope = await this.preprocessAI.preprocess({ title, tripInput });
      const validation = validatePreprocessEnvelope(envelope);
      if (!validation.ok) {
        console.warn(
          `PREPROCESS AI 响应验证失败（${validation.failureReasonCode} @ ${validation.failurePath}），本次创建不写入 AI Context`,
        );
      } else {
        aiContext = buildTripAIContext(envelope, tripInput, new Date().toISOString());
      }
    } catch (error) {
      console.warn(
        `PREPROCESS AI 调用失败（${error instanceof Error ? error.message : 'unknown'}），本次创建不写入 AI Context`,
      );
    }

    const tripBase: Omit<Trip, 'roomCode'> = {
      id: `trip_${crypto.randomUUID()}`,
      title,
      status: 'ACTIVE',
      creatorId: authenticatedUserId,
      participantIds: [authenticatedUserId],
      createdAt: new Date().toISOString(),
      initialBrief,
      areaConstraint: input.areaConstraint,
      timeRange: input.timeRange,
      commentIds: [],
      constraintIds: [],
      ...(aiContext ? { aiContext } : {}),
    };

    // 仓库在最终提交点再次保证 roomCode 唯一；并发碰撞时重新生成而不是写入歧义数据。
    for (let attempt = 0; attempt < 50; attempt++) {
      const trip: Trip = {
        ...tripBase,
        roomCode: await this.generateUniqueRoomCode(),
      };
      try {
        return await this.trips.create(trip);
      } catch (error) {
        if (error instanceof AppError && error.code === 'ROOM_CODE_CONFLICT') {
          continue;
        }
        throw error;
      }
    }
    throw new AppError(500, 'ROOM_CODE_GENERATION_FAILED', '房间号生成失败，请重试');
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

  async getJoinPreview(roomCodeInput: string): Promise<TripJoinPreview> {
    const roomCode = this.validateRoomCode(roomCodeInput);
    const trip = await this.trips.findByRoomCode(roomCode);
    if (!trip) {
      throw new AppError(404, 'TRIP_NOT_FOUND', '行程不存在');
    }
    return {
      roomCode: trip.roomCode,
      title: trip.title,
      participantCount: trip.participantIds.length,
      status: trip.status,
    };
  }

  async joinTrip(authenticatedUserId: string, roomCodeInput: string): Promise<Trip> {
    const roomCode = this.validateRoomCode(roomCodeInput);
    const trip = await this.trips.findByRoomCode(roomCode);
    if (!trip) {
      throw new AppError(404, 'TRIP_NOT_FOUND', '行程不存在');
    }
    if (trip.status !== 'ACTIVE') {
      throw new AppError(409, 'TRIP_NOT_JOINABLE', '该行程当前不可加入');
    }
    return this.trips.addParticipant(trip.id, authenticatedUserId);
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

  /** 删除行程：仅 creator 可操作；硬删除，从持久化中彻底移除，无任何软删/回收站。 */
  async deleteTrip(authenticatedUserId: string, tripId: string): Promise<void> {
    const trip = await this.trips.findById(tripId);
    if (!trip) {
      throw new AppError(404, 'TRIP_NOT_FOUND', '行程不存在');
    }
    // 身份只来自认证 token；participant（含其他任何用户）均无权删除他人行程。
    if (authenticatedUserId !== trip.creatorId) {
      throw new AppError(403, 'TRIP_FORBIDDEN', '仅行程发起人可删除行程');
    }
    await this.trips.remove(trip.id);
  }

  private validateRoomCode(input: string): string {
    const roomCode = normalizeRoomCode(input);
    if (!isValidRoomCode(roomCode)) {
      throw new AppError(400, 'TRIP_INVALID_ROOM_CODE', '房间号格式无效');
    }
    return roomCode;
  }
}
