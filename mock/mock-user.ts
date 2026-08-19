// mock/mock-user.ts
// Mock 用户数据

import { Participant } from '../types/participant';

export const mockCurrentUser: Participant = {
  id: 'user_A',
  nickname: '阿明',
  avatarUrl: '',
  isCreator: true,
};

export const mockParticipants: Participant[] = [
  mockCurrentUser,
  { id: 'user_B', nickname: '小B' },
  { id: 'user_C', nickname: '小C' },
  { id: 'user_D', nickname: '小D' },
];

export function getParticipantById(id: string): Participant | undefined {
  return mockParticipants.find((p) => p.id === id);
}