// tests/current-user.test.ts
// 当前用户身份链路测试：
// - 发送/评论必须使用真实 currentUser，绝不使用 Mock“阿明”
// - 无登录态时发送被阻止
// - Mock 其他参与者保留
// - Mock trip 中的“自己”槽位运行时 hydrate 为真实用户

import { mockActiveTrip } from '../mock/mock-trip';
import { mockPersonalRoute } from '../mock/mock-routes';
import { mockParticipants, getParticipantById, mockDevCurrentUser } from '../mock/mock-user';
import {
  buildUserComment,
  currentUserToParticipant,
  hydrateRouteOwner,
  hydrateTripWithCurrentUser,
  isSameUser,
  MOCK_SELF_ID,
  requireCurrentUser,
  resolveAuthorAvatar,
  resolveAuthorDisplayName,
} from '../utils/current-user';
import { Participant } from '../types/participant';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

// ---- 1. 真实当前用户发送 ----
{
  const currentUser: Participant = { id: 'real-user-1', nickname: '微信用户' };
  const comment = buildUserComment('trip_active', '我想六点后出发', currentUser, new Date('2026-08-20T10:00:00Z'));
  assert(comment.userId === 'real-user-1', 'authorId 必须为 currentUser.id');
  assert(comment.rawText === '我想六点后出发', '原始文本保留');
  assert(comment.tripId === 'trip_active', 'tripId 正确');
  const display = resolveAuthorDisplayName(comment.userId, currentUser, mockParticipants);
  assert(display === '微信用户', `发送者应显示为 currentUser.nickname，实际：${display}`);
}

// ---- 2. 昵称变化：不硬编码“微信用户”或“阿明” ----
{
  const currentUser: Participant = { id: 'real-user-2', nickname: 'Zi Wun' };
  const comment = buildUserComment('trip_active', '我想六点后出发', currentUser);
  const display = resolveAuthorDisplayName(comment.userId, currentUser, mockParticipants);
  assert(display === 'Zi Wun', `应跟随 currentUser.nickname，实际：${display}`);
  assert(display !== '阿明', '绝不能显示为阿明');
  assert(display !== '微信用户', '不硬编码微信用户');
}

// ---- 3. 无登录态发送：必须被阻止，不产生阿明消息 ----
{
  const guard = requireCurrentUser(null);
  assert(guard.ok === false, 'currentUser=null 时发送必须被阻止');
  assert(guard.ok === false && guard.reason === 'NOT_AUTHENTICATED', '守卫原因应为 NOT_AUTHENTICATED');
}

// ---- 4. 其他 Mock 参与者保留 ----
{
  const names = mockParticipants.map((p) => p.nickname);
  assert(names.includes('小B') && names.includes('小C') && names.includes('小D'), '其他 Mock 参与者必须保留');
  assert(!names.includes('阿明'), 'Mock 参与者中不再有阿明');
  assert(getParticipantById('user_B')?.nickname === '小B', 'getParticipantById 仍可解析其他参与者');
  // 即使历史数据出现 user_A，也不应解析为阿明
  assert(resolveAuthorDisplayName('user_A', null, mockParticipants) !== '阿明', 'user_A 不再映射为阿明');
}

// ---- 5. Mock trip 运行时 hydrate：mock self → 真实 currentUser ----
{
  const currentUser: Participant = { id: 'real-user-1', nickname: '微信用户' };
  const hydrated = hydrateTripWithCurrentUser(mockActiveTrip, currentUser);
  assert(hydrated.creatorId === 'real-user-1', `creatorId 应替换为 currentUser.id，实际：${hydrated.creatorId}`);
  assert(!hydrated.participantIds.includes(MOCK_SELF_ID), 'participantIds 中不得再含 mock self（user_A）');
  assert(hydrated.participantIds.includes('real-user-1'), 'participantIds 应包含当前用户');
  assert(hydrated.participantIds.includes('user_B') && hydrated.participantIds.includes('user_C'), '其他 Mock 参与者保留');
  assert(hydrated.participantIds.length === mockActiveTrip.participantIds.length, '替换后人数不变（去重）');
}

// ---- 6. 无登录态时不 hydrate（保持原样，但操作被守卫拦截） ----
{
  const hydrated = hydrateTripWithCurrentUser(mockActiveTrip, null);
  assert(hydrated.creatorId === MOCK_SELF_ID, '无 currentUser 时 trip 保持原样');
}

// ---- 7. 个人路线 owner hydrate ----
{
  const currentUser: Participant = { id: 'real-user-1', nickname: '微信用户' };
  const route = hydrateRouteOwner(mockPersonalRoute, currentUser);
  assert(route.ownerId === 'real-user-1', `route.ownerId 应替换为 currentUser.id，实际：${route.ownerId}`);
}

// ---- 8. 转换边界：ID 保留、昵称映射、无 openid 泄漏 ----
{
  const adapted = currentUserToParticipant({ id: 'wx_123', nickname: '微信用户', avatarUrl: 'https://img/a.png' });
  assert(adapted.id === 'wx_123', '真实 ID 保持不变');
  assert(adapted.nickname === '微信用户', 'nickname 映射为参与者显示名');
  assert(adapted.avatarUrl === 'https://img/a.png', 'avatarUrl 透传');
  assert(!('openid' in adapted), '不得引入 openid 等认证字段');
}

// ---- 9. 身份判断基于 ID，不基于名称 ----
{
  const currentUser: Participant = { id: 'real-user-1', nickname: '阿明' };
  assert(isSameUser('real-user-1', currentUser) === true, '相同 ID 判定为当前用户');
  assert(isSameUser('user_A', currentUser) === false, '不同 ID 不是当前用户（即使昵称相同）');
}

// ---- 10. 头像：优先 currentUser.avatarUrl，空则交给默认 fallback ----
{
  const withAvatar: Participant = { id: 'real-user-1', nickname: '微信用户', avatarUrl: 'https://img/me.png' };
  assert(resolveAuthorAvatar('real-user-1', withAvatar, mockParticipants) === 'https://img/me.png', '应使用 currentUser.avatarUrl');
  const noAvatar: Participant = { id: 'real-user-1', nickname: '微信用户' };
  assert(resolveAuthorAvatar('real-user-1', noAvatar, mockParticipants) === '', 'avatarUrl 为空时不回退到 Mock 头像');
}

// ---- 11. mock 开发当前用户与业务 Mock 数据无重叠 ----
{
  assert(mockDevCurrentUser.id !== MOCK_SELF_ID, '开发模式当前用户不得占用 mock self ID');
  assert(mockDevCurrentUser.nickname !== '阿明', '开发模式当前用户不得叫阿明');
}

console.log('✅ current-user.test.ts 全部通过');
