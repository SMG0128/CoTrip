// mock/mock-comments.ts
// Mock 评论数据

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
    rawText: '羽毛球只想在天河打，吃饭可以去越秀。',
    createdAt: '2026-08-16T09:10:00+08:00',
    aiStatus: 'accepted',
  },
  {
    id: 'comment_003',
    tripId: 'trip_active',
    userId: 'user_D',
    rawText: '最近没什么钱，便宜一点。',
    createdAt: '2026-08-16T09:20:00+08:00',
    aiStatus: 'accepted',
  },
  {
    id: 'comment_004',
    tripId: 'trip_active',
    userId: 'user_D',
    rawText: '希望总预算 ≤ ¥70',
    createdAt: '2026-08-16T09:30:00+08:00',
    aiStatus: 'conflict',
  },
];