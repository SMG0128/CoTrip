// tests/trip-ownership.test.ts
// 真实 Trip Ownership 测试（Test A-F）：
// - 新 Trip 的 creatorId / 默认 participant 必须来自真实 currentUser.id
// - 禁止产生 user_A / MOCK_SELF_ID / mockDevCurrentUser 作为 owner
// - 昵称变化不影响 ownership（ID 判断）
// - 无登录态创建被阻止
// - 旧 Mock fixture 通过 runtime hydration 兼容

import { mockActiveTrip } from '../mock/mock-trip';
import { mockDevCurrentUser } from '../mock/mock-user';
import {
  buildOwnedTrip,
  hydrateTripWithCurrentUser,
  isTripOwner,
  MOCK_SELF_ID,
  requireCurrentUser,
} from '../utils/current-user';
import { Participant } from '../types/participant';
import { Trip } from '../types/trip';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

const realUser: Participant = { id: 'usr_123', nickname: '微信用户' };

// ---- Test A — real owner ----
{
  const trip = buildOwnedTrip(
    { title: '顺德周末游', initialBrief: '顺德周末游' },
    realUser,
    new Date('2026-08-20T10:00:00Z')
  );
  assert(trip.creatorId === 'usr_123', `creatorId 必须为 currentUser.id，实际：${trip.creatorId}`);
  assert(trip.participantIds.includes('usr_123'), '创建者必须默认为 participant');
  assert(trip.participantIds.length === 1, '新 Trip 只含创建者本人，不塞 Mock companion');
  assert(trip.creatorId !== 'user_A', 'creatorId 不得为 user_A');
  assert(trip.creatorId !== MOCK_SELF_ID, 'creatorId 不得为 mock self placeholder');
  assert(trip.creatorId !== mockDevCurrentUser.id, 'creatorId 不得为 mockDevCurrentUser');
}

// ---- Test B — nickname change does not affect ownership ----
{
  const renamed: Participant = { id: 'usr_123', nickname: 'Zi Wun' };
  const trip = { creatorId: 'usr_123' } as Trip;
  assert(isTripOwner(trip, renamed) === true, '昵称变化后 ownership 仍成立（ID 判断）');
  assert(isTripOwner(trip, realUser) === true, '原昵称下同样是 owner');
}

// ---- Test C — another user is not owner ----
{
  const other: Participant = { id: 'usr_456', nickname: '小美' };
  const trip = { creatorId: 'usr_123' } as Trip;
  assert(isTripOwner(trip, other) === false, '其他用户不应拥有该 Trip');
  assert(isTripOwner(trip, null) === false, '无登录态时不是 owner');
}

// ---- Test D — unauthenticated create is blocked, no mock trip produced ----
{
  const guard = requireCurrentUser(null);
  assert(guard.ok === false, 'currentUser=null 创建必须被阻止');
  assert(guard.ok === false && guard.reason === 'NOT_AUTHENTICATED', '守卫原因应为 NOT_AUTHENTICATED');
  // 守卫失败即中止，不产生任何 Trip（绝不回退到 user_A / mockDevCurrentUser）
  const trip: Trip | null = guard.ok ? buildOwnedTrip({ title: 'x', initialBrief: '' }, guard.user) : null;
  assert(trip === null, '未登录不得产生 Trip');
}

// ---- Test E — old Mock fixture compatibility via runtime hydration ----
{
  const currentUser: Participant = { id: 'usr_real_001', nickname: '微信用户' };
  const hydrated = hydrateTripWithCurrentUser(mockActiveTrip, currentUser);
  assert(
    hydrated.creatorId === 'usr_real_001',
    `旧 fixture 的 creatorId 应替换为 currentUser.id，实际：${hydrated.creatorId}`
  );
  assert(!hydrated.participantIds.includes(MOCK_SELF_ID), '旧 fixture 中不应再残留 mock self');
  assert(hydrated.participantIds.includes('usr_real_001'), '旧 fixture 应包含当前用户');
}

// ---- Test F — new Trip needs no hydration ----
{
  const trip = buildOwnedTrip(
    { title: '顺德一日游', initialBrief: '顺德一日游' },
    { id: 'usr_real_001', nickname: '微信用户' },
    new Date('2026-08-20T11:00:00Z')
  );
  assert(trip.creatorId === 'usr_real_001', '新 Trip 天然属于 currentUser.id');
  assert(trip.participantIds.includes('usr_real_001'), '新 Trip 默认 participant 正确');
  // 即使执行 hydrate，新 Trip ownership 也不变（幂等）
  const hydrated = hydrateTripWithCurrentUser(trip, { id: 'someone_else', nickname: '别人' });
  assert(hydrated.creatorId === 'usr_real_001', '新 Trip 不依赖 hydrate 也不被 hydrate 改变');
}

console.log('✅ trip-ownership.test.ts 全部通过');
