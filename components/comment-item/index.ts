// components/comment-item/index.ts
// 评论条目组件：展示用户昵称、原始文本与 AI 状态。
// 身份解析按 ID 优先匹配当前登录用户（currentUser），其次才匹配 Mock 参与者。

import { Comment } from '../../types/comment';
import { mockParticipants } from '../../mock/mock-user';
import { resolveAuthorAvatar, resolveAuthorDisplayName } from '../../utils/current-user';

Component({
  properties: {
    comment: {
      type: Object,
      value: null as Comment | null,
    },
  },
  data: {
    nickname: '',
    avatarUrl: '',
  },
  observers: {
    comment(comment: Comment | null) {
      if (!comment) return;
      const app = getApp<IAppOption>();
      const currentUser = app.globalData.currentUser;
      this.setData({
        nickname: resolveAuthorDisplayName(comment.userId, currentUser, mockParticipants),
        avatarUrl: resolveAuthorAvatar(comment.userId, currentUser, mockParticipants),
      });
    },
  },
});
