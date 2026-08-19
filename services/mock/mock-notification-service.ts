// services/mock/mock-notification-service.ts
// NotificationService 的 Mock 实现。

import { NotificationService } from '../notification-service';
import { Notification } from '../../types/notification';

const mockNotifications: Notification[] = [
  {
    id: 'notif_001',
    tripId: 'trip_active',
    userId: 'user_A',
    type: 'DEPARTURE_REMINDER',
    title: '该出发啦',
    body: '距离羽毛球馆预计 47 分钟，建议现在出发。',
    createdAt: '2026-08-22T09:20:00+08:00',
    read: false,
  },
];

export class MockNotificationService implements NotificationService {
  async listNotifications(userId: string): Promise<Notification[]> {
    return mockNotifications.filter((n) => n.userId === userId);
  }

  async markRead(notificationId: string): Promise<void> {
    const n = mockNotifications.find((x) => x.id === notificationId);
    if (n) n.read = true;
  }
}