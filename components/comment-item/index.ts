// components/comment-item/index.ts
// 评论条目组件：展示用户昵称、原始文本与 AI 状态。

import { Comment } from '../../types/comment';
import { getParticipantById } from '../../mock/mock-user';

Component({
  properties: {
    comment: {
      type: Object,
      value: null as Comment | null,
    },
  },
  data: {
    nickname: '',
  },
  observers: {
    comment(comment: Comment | null) {
      if (!comment) return;
      const p = getParticipantById(comment.userId);
      this.setData({ nickname: p?.nickname ?? '未知用户' });
    },
  },
});