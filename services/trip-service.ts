// services/trip-service.ts
// 行程服务接口：负责行程的创建、查询、状态流转。
// 当前仅定义接口，不接真实后端。

import { Trip } from '../types/trip';

export interface CreateTripInput {
  title: string;
  creatorId: string;
  initialBrief: string;
  areaConstraint?: Trip['areaConstraint'];
  timeRange?: Trip['timeRange'];
}

export interface TripService {
  createTrip(input: CreateTripInput): Promise<Trip>;
  getTrip(tripId: string): Promise<Trip | null>;
  listActiveTrips(): Promise<Trip[]>;
  listHistoryTrips(): Promise<Trip[]>;
  completeTrip(tripId: string): Promise<Trip>;
}