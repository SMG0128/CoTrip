// types/notification.ts
// 通知

export type NotificationType =
  | 'TRIP_STARTING'
  | 'DEPARTURE_REMINDER'
  | 'PLAN_CHANGED'
  | 'CONFLICT'
  | 'LOCATION_CHANGED';

export interface Notification {
  id: string;
  tripId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}