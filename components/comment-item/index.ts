// components/comment-item/index.ts
// 评论条目组件：展示用户昵称、原始文本与 AI 状态。
// 真实评论只使用服务端 author；Mock 参与者解析严格限制在唯一 Demo Trip。

import { Comment } from '../../types/comment';
import { mockParticipants } from '../../mock/mock-user';
import { resolveCommentAuthorPresentation } from '../../utils/comment-author';

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
      this.setData(resolveCommentAuthorPresentation(comment, currentUser, mockParticipants));
    },
  },
});
