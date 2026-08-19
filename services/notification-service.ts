// services/notification-service.ts
// 通知服务接口：围绕行程执行的通知。
// 当前仅 Mock。

import { Notification } from '../types/notification';

export interface NotificationService {
  listNotifications(userId: string): Promise<Notification[]>;
  markRead(notificationId: string): Promise<void>;
}