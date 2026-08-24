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
  /** 是否已完成首次资料完善（来自服务端；缺省视为未完成） */
  profileCompleted?: boolean;
}