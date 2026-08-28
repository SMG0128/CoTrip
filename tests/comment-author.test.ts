import { mockParticipants } from '../mock/mock-user';
import { Comment } from '../types/comment';
import { DEMO_TRIP_ID } from '../utils/demo-trip';
import { resolveCommentAuthorPresentation } from '../utils/comment-author';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`断言失败: ${message}`);
}

function comment(overrides: Partial<Comment>): Comment {
  return {
    id: 'comment_1',
    tripId: 'trip_real',
    userId: 'user_B',
    rawText: '测试',
    createdAt: '2026-08-28T00:00:00.000Z',
    aiStatus: 'unresolved',
    ...overrides,
  };
}

const real = resolveCommentAuthorPresentation(comment({
  author: { id: 'user_B', nickname: '真实用户 B', avatarUrl: 'https://real/b.png' },
}), null, mockParticipants);
assert(real.nickname === '真实用户 B', '真实评论必须显示服务端 author');
assert(real.avatarUrl === 'https://real/b.png', '真实评论必须显示服务端头像');

const missingRealAuthor = resolveCommentAuthorPresentation(comment({}), null, mockParticipants);
assert(missingRealAuthor.nickname === '用户资料不可用', '真实评论缺 author 时不得泄漏 Mock 昵称');
assert(
  missingRealAuthor.nickname !== mockParticipants.find((participant) => participant.id === 'user_B')?.nickname,
  '真实 userId 即使碰巧命中 Mock id 也不得使用 Mock participant',
);

const demo = resolveCommentAuthorPresentation(comment({ tripId: DEMO_TRIP_ID }), null, mockParticipants);
assert(demo.nickname === mockParticipants.find((participant) => participant.id === 'user_B')?.nickname, 'Demo 可继续使用 fixture 作者');

console.log('✅ comment-author.test.ts 全部通过');
