// 评论作者展示投影。真实评论只信任服务端 author；Demo 才允许 fixture 解析。

import { Comment } from '../types/comment';
import { Participant } from '../types/participant';
import { isDemoTripId } from './demo-trip';
import { resolveAuthorAvatar, resolveAuthorDisplayName } from './current-user';

export interface CommentAuthorPresentation {
  nickname: string;
  avatarUrl: string;
}

export function resolveCommentAuthorPresentation(
  comment: Comment,
  currentUser: Participant | null | undefined,
  demoParticipants: Participant[],
): CommentAuthorPresentation {
  if (comment.author) {
    return {
      nickname: comment.author.nickname,
      avatarUrl: comment.author.avatarUrl,
    };
  }
  if (isDemoTripId(comment.tripId)) {
    return {
      nickname: resolveAuthorDisplayName(comment.userId, currentUser, demoParticipants),
      avatarUrl: resolveAuthorAvatar(comment.userId, currentUser, demoParticipants),
    };
  }
  return { nickname: '用户资料不可用', avatarUrl: '' };
}
