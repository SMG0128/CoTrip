// mock/mock-user.ts
// Mock 参与者数据（仅“其他人”）。
// 当前登录用户身份一律来自 app.globalData.currentUser（真实登录），
// 这里不再提供代表“自己”的 mockCurrentUser（阿明）。

import { Participant } from '../types/participant';

/** 其他（非当前用户）Mock 参与者 */
export const mockParticipants: Participant[] = [
  { id: 'user_B', nickname: '小B' },
  { id: 'user_C', nickname: '小C' },
  { id: 'user_D', nickname: '小D' },
];

/**
 * Mock 开发模式（config/auth.ts mode = 'mock'）下的当前登录用户。
 * 仅用于后端未就绪时的本地演示；与业务 Mock 数据（user_A/user_B/...）无重叠。
 */
export const mockDevCurrentUser: Participant = {
  id: 'dev_current_user',
  nickname: '开发用户',
  avatarUrl: '',
};

export function getParticipantById(id: string): Participant | undefined {
  return mockParticipants.find((p) => p.id === id);
}
