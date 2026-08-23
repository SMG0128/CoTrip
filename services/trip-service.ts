// services/trip-service.ts
// 行程服务接口：负责行程的创建、查询、状态流转。
// 当前仅定义接口，不接真实后端。

import { Trip, TripStatus } from '../types/trip';

export interface CreateTripInput {
  title: string;
  creatorId: string;
  initialBrief: string;
  areaConstraint?: Trip['areaConstraint'];
  timeRange?: Trip['timeRange'];
}

/** 加入页所需的最小公开信息；不得包含用户身份或参与者 ID。 */
export interface TripJoinPreview {
  roomCode: string;
  title: string;
  participantCount: number;
  status: TripStatus;
}

export interface TripService {
  createTrip(input: CreateTripInput): Promise<Trip>;
  getTrip(tripId: string): Promise<Trip | null>;
  getJoinPreview(roomCode: string): Promise<TripJoinPreview | null>;
  joinTrip(roomCode: string): Promise<Trip>;
  listActiveTrips(): Promise<Trip[]>;
  listHistoryTrips(): Promise<Trip[]>;
  completeTrip(tripId: string): Promise<Trip>;
}
