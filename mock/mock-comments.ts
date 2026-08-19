// mock/mock-comments.ts
// Mock 评论数据（V0.3 真实地点 Demo）

import { Comment } from '../types/comment';

export const mockComments: Comment[] = [
  {
    id: 'comment_001',
    tripId: 'trip_active',
    userId: 'user_B',
    rawText: '我 10 点以后才有空',
    createdAt: '2026-08-16T09:00:00+08:00',
    aiStatus: 'accepted',
  },
  {
    id: 'comment_002',
    tripId: 'trip_active',
    userId: 'user_C',
    rawText: '羽毛球必须在天河',
    createdAt: '2026-08-16T09:10:00+08:00',
    aiStatus: 'accepted',
  },
  {
    id: 'comment_003',
    tripId: 'trip_active',
    userId: 'user_D',
    rawText: '最好在越秀吃越南菜',
    createdAt: '2026-08-16T09:20:00+08:00',
    aiStatus: 'accepted',
  },
  {
    id: 'comment_004',
    tripId: 'trip_active',
    userId: 'user_D',
    rawText: '人均最好不要超过80',
    createdAt: '2026-08-16T09:30:00+08:00',
    aiStatus: 'accepted',
  },
];