// services/mock/mock-trip-service.ts
// TripService 的 Mock 实现：基于内存数据。

import {
  TripService,
  CreateTripInput,
  TripJoinPreview,
} from '../trip-service';
import { Trip } from '../../types/trip';
import { mockActiveTrip, mockHistoryTrip } from '../../mock/mock-trip';
import { mockDevCurrentUser } from '../../mock/mock-user';
import { Participant } from '../../types/participant';
import { buildOwnedTrip } from '../../utils/current-user';
import { isValidRoomCode, normalizeRoomCode } from '../../utils/room-code';

export class MockTripServiceError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'MockTripServiceError';
  }
}

function cloneTrip(trip: Trip): Trip {
  return {
    ...trip,
    participantIds: [...trip.participantIds],
    commentIds: [...trip.commentIds],
    constraintIds: [...trip.constraintIds],
  };
}

export class MockTripService implements TripService {
  private trips: Trip[];

  /** 仅用于 local/mock development；真实模式绝不会实例化或回退到这里。 */
  constructor(
    trips: Trip[] = [mockActiveTrip, mockHistoryTrip],
    private readonly currentUser: Participant = mockDevCurrentUser
  ) {
    this.trips = trips.map(cloneTrip);
  }

  async createTrip(input: CreateTripInput): Promise<Trip> {
    // 所有权构造统一走 buildOwnedTrip：
    // creatorId 来自调用方传入的当前用户身份，默认 participant 仅创建者本人，
    // 新 Trip 天然属于真实用户，无任何 Mock 占位身份。
    const trip = buildOwnedTrip(input, { id: input.creatorId, nickname: '' });
    this.trips.unshift(trip);
    return trip;
  }

  async getTrip(tripId: string): Promise<Trip | null> {
    return this.trips.find((t) => t.id === tripId) ?? null;
  }

  async getJoinPreview(roomCode: string): Promise<TripJoinPreview | null> {
    const trip = this.findByRoomCode(roomCode);
    if (!trip) return null;
    return {
      roomCode: trip.roomCode!,
      title: trip.title,
      participantCount: trip.participantIds.length,
      status: trip.status,
    };
  }

  async joinTrip(roomCode: string): Promise<Trip> {
    const trip = this.findByRoomCode(roomCode);
    if (!trip) {
      throw new MockTripServiceError('未找到对应行程', 'TRIP_NOT_FOUND');
    }
    if (trip.status !== 'ACTIVE') {
      throw new MockTripServiceError('该行程当前不可加入', 'TRIP_NOT_JOINABLE');
    }
    if (!trip.participantIds.includes(this.currentUser.id)) {
      trip.participantIds.push(this.currentUser.id);
    }
    return trip;
  }

  async listActiveTrips(): Promise<Trip[]> {
    return this.trips.filter((t) => t.status === 'ACTIVE');
  }

  async listHistoryTrips(): Promise<Trip[]> {
    return this.trips.filter((t) => t.status === 'COMPLETED');
  }

  async completeTrip(tripId: string): Promise<Trip> {
    const trip = this.trips.find((t) => t.id === tripId);
    if (!trip) throw new Error('trip not found');
    trip.status = 'COMPLETED';
    trip.completedAt = new Date().toISOString();
    return trip;
  }

  private findByRoomCode(roomCode: string): Trip | null {
    const normalized = normalizeRoomCode(roomCode);
    if (!isValidRoomCode(normalized)) return null;
    return this.trips.find((trip) => normalizeRoomCode(trip.roomCode) === normalized) ?? null;
  }
}
