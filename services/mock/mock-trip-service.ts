// services/mock/mock-trip-service.ts
// TripService 的 Mock 实现：基于内存数据。

import { TripService, CreateTripInput } from '../trip-service';
import { Trip } from '../../types/trip';
import { mockActiveTrip, mockHistoryTrip } from '../../mock/mock-trip';

export class MockTripService implements TripService {
  private trips: Trip[] = [mockActiveTrip, mockHistoryTrip];

  async createTrip(input: CreateTripInput): Promise<Trip> {
    const trip: Trip = {
      id: `trip_${Date.now()}`,
      title: input.title,
      status: 'ACTIVE',
      creatorId: input.creatorId,
      participantIds: [input.creatorId],
      createdAt: new Date().toISOString(),
      initialBrief: input.initialBrief,
      areaConstraint: input.areaConstraint,
      timeRange: input.timeRange,
      commentIds: [],
      constraintIds: [],
    };
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