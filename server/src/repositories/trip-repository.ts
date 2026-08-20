import { Trip, TripStatus } from '../types/trip';

export interface TripRepository {
  create(trip: Trip): Promise<Trip>;
  findById(id: string): Promise<Trip | null>;
  listForUser(userId: string, status?: TripStatus): Promise<Trip[]>;
}
