// types/participant.ts
// 参与者

export interface Participant {
  /** CoTrip 内部用户 ID（由后端签发，业务层统一使用） */
  id: string;
  /** 微信昵称 */
  nickname: string;
  /** 微信头像 URL */
  avatarUrl?: string;
  /** 是否行程创建者 */
  isCreator?: boolean;
}