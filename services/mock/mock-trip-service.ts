// services/mock/mock-trip-service.ts
// TripService 的 Mock 实现：基于内存数据。

import { TripService, CreateTripInput } from '../trip-service';
import { Trip } from '../../types/trip';
import { mockActiveTrip, mockHistoryTrip } from '../../mock/mock-trip';
import { buildOwnedTrip } from '../../utils/current-user';

export class MockTripService implements TripService {
  private trips: Trip[] = [mockActiveTrip, mockHistoryTrip];

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
}