// utils/current-user.ts
// 当前用户身份层：认证层 → Trip Core 的最小转换边界。
//
// 原则：
// - 当前登录用户身份唯一来源是 app.globalData.currentUser（登录结果中的 Participant）。
// - 禁止用 nickname === '阿明' 判断身份，一律按 id === currentUser.id。
// - Mock 数据中的“自己”占位 ID（MOCK_SELF_ID）在运行时 hydrate 为真实 currentUser，
//   其余 Mock 参与者保持不变。
// - 无 currentUser 时禁止任何已认证用户操作（发送/创建等），绝不回退到 Mock 用户。

import { Participant } from '../types/participant';
import { Trip } from '../types/trip';
import { Route } from '../types/route';
import { Comment } from '../types/comment';

/** Mock 数据中代表“自己”的占位 ID（fixture 边界；运行时由真实 currentUser.id 替换） */
export const MOCK_SELF_ID = 'user_A';

/**
 * 认证/登录层用户 → 业务 Participant 的最小转换边界。
 * 真实 ID 保持不变；nickname → 参与者显示名；avatarUrl → 头像。
 * profileCompleted（首次资料完善标记）原样透传，未提供时为 undefined。
 * 不引入 openid / 微信身份字段，避免认证层与 Trip Core 强耦合。
 */
export function currentUserToParticipant(user: {
  id: string;
  nickname: string;
  avatarUrl?: string;
  profileCompleted?: boolean;
}): Participant {
  return {
    id: user.id,
    nickname: user.nickname,
    avatarUrl: user.avatarUrl,
    profileCompleted: user.profileCompleted,
  };
}

/** 基于 ID 判断是否为当前用户（禁止名称判断） */
export function isSameUser(
  userId: string | undefined | null,
  currentUser: Participant | null | undefined
): boolean {
  return !!userId && !!currentUser && userId === currentUser.id;
}

/**
 * 基于稳定 ID 判断行程所有权（禁止 nickname/名称判断）。
 * 昵称变化不影响结果：ownership 只依赖 creatorId === currentUser.id。
 */
export function isTripOwner(
  trip: { creatorId: string } | null | undefined,
  currentUser: Participant | null | undefined
): boolean {
  return !!trip && isSameUser(trip.creatorId, currentUser);
}

/** 新 Trip 创建输入（与 CreateTripInput 对齐的最小字段） */
export interface OwnedTripInput {
  title: string;
  initialBrief: string;
  areaConstraint?: Trip['areaConstraint'];
  timeRange?: Trip['timeRange'];
}

/**
 * 构造一个天然属于当前真实用户的新 Trip。
 * - creatorId = currentUser.id（绝不产生 user_A / mockDevCurrentUser）
 * - 默认 participant 仅创建者本人，不自动注入 Mock companion
 * - 新 Trip 不需要 runtime hydration（mock self 替换只服务旧 fixture）
 */
export function buildOwnedTrip(
  input: OwnedTripInput,
  currentUser: Participant,
  now: Date = new Date()
): Trip {
  return {
    // 时间戳 + 随机后缀：保证同一毫秒内连续创建多个 Trip 时 id 不碰撞
    // （多进行中 Trip 场景下，重复 id 会导致首页卡片 key 冲突、导航错乱）。
    id: `trip_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`,
    title: input.title,
    status: 'ACTIVE',
    creatorId: currentUser.id,
    participantIds: [currentUser.id],
    createdAt: now.toISOString(),
    initialBrief: input.initialBrief,
    areaConstraint: input.areaConstraint,
    timeRange: input.timeRange,
    commentIds: [],
    constraintIds: [],
  };
}

/**
 * 运行时 hydrate：把 Mock trip 中的“自己”槽位（MOCK_SELF_ID）替换为真实 currentUser，
 * 保证不会同时出现“阿明 + 微信用户”代表同一个人。
 * currentUser 为空时不修改（保持原样，但已认证操作会被守卫拦截）。
 */
export function hydrateTripWithCurrentUser(
  trip: Trip,
  currentUser: Participant | null | undefined
): Trip {
  if (!currentUser) return trip;
  const participantIds = Array.from(
    new Set(trip.participantIds.map((id) => (id === MOCK_SELF_ID ? currentUser.id : id)))
  );
  return {
    ...trip,
    creatorId: trip.creatorId === MOCK_SELF_ID ? currentUser.id : trip.creatorId,
    participantIds,
  };
}

/** 个人路线 owner 同步 hydrate（mock self → currentUser.id） */
export function hydrateRouteOwner<T extends Pick<Route, 'ownerId'>>(
  route: T,
  currentUser: Participant | null | undefined
): T {
  if (!currentUser || route.ownerId !== MOCK_SELF_ID) return route;
  return { ...route, ownerId: currentUser.id };
}

/** 发送等已认证操作的前置守卫：无 currentUser 时禁止操作 */
export type AuthGuardResult =
  | { ok: true; user: Participant }
  | { ok: false; reason: 'NOT_AUTHENTICATED' };

export function requireCurrentUser(
  currentUser: Participant | null | undefined
): AuthGuardResult {
  return currentUser ? { ok: true, user: currentUser } : { ok: false, reason: 'NOT_AUTHENTICATED' };
}

/** 用当前用户构造评论（author 必须使用 currentUser.id，绝不使用 Mock 用户） */
export function buildUserComment(
  tripId: string,
  rawText: string,
  currentUser: Participant,
  now: Date = new Date()
): Comment {
  return {
    id: `comment_${now.getTime()}`,
    tripId,
    userId: currentUser.id,
    rawText,
    createdAt: now.toISOString(),
    aiStatus: 'processing',
  };
}

/** 评论作者昵称解析：优先按 ID 匹配当前用户，其次在参与表中查找，兜底“未知用户” */
export function resolveAuthorDisplayName(
  userId: string,
  currentUser: Participant | null | undefined,
  participants: Participant[]
): string {
  if (isSameUser(userId, currentUser)) return currentUser!.nickname;
  const p = participants.find((it) => it.id === userId);
  return p?.nickname ?? '未知用户';
}

/** 评论作者头像解析：优先当前用户 avatarUrl，其次参与者，空则交给统一默认头像 fallback */
export function resolveAuthorAvatar(
  userId: string,
  currentUser: Participant | null | undefined,
  participants: Participant[]
): string {
  if (isSameUser(userId, currentUser)) return currentUser!.avatarUrl ?? '';
  const p = participants.find((it) => it.id === userId);
  return p?.avatarUrl ?? '';
}
