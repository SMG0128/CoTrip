// types/participant.ts
// 参与者

export interface Participant {
  id: string;
  /** 微信昵称（Mock） */
  nickname: string;
  /** 微信头像 URL（Mock） */
  avatarUrl?: string;
  /** 是否行程创建者 */
  isCreator?: boolean;
}