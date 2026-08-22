// utils/trip-complete.ts
// 「完成行程」可测逻辑层：权限判定 + 二次确认文案 + 依赖注入流程执行器。
// 页面只负责组装 deps（wx.showModal / tripService / setData），业务规则全部收敛在此，
// 便于纯 Node 测试覆盖整条链路。

import { Participant } from '../types/participant';
import { Trip } from '../types/trip';
import { isTripOwner } from './current-user';

/** 二次确认弹窗配置（wx.showModal 参数） */
export function buildCompleteTripModal(): {
  title: string;
  content: string;
  confirmText: string;
  cancelText: string;
} {
  return {
    title: '完成行程',
    content: '完成后，该行程将从「正在进行」移入「历史行程」。确定要完成吗？',
    confirmText: '完成',
    cancelText: '再等等',
  };
}

/** 完成行程权限判定结果：allowed=false 时给出机器可读 reason */
export type CompleteTripPermission =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'NOT_OWNER' | 'IN_PROGRESS' | 'TRIP_NOT_ACTIVE' | 'TRIP_ALREADY_COMPLETED';
    };

/**
 * 完成行程权限判定：
 * - 非 owner（按 id 判断，内部走 isTripOwner，禁止昵称判断）→ NOT_OWNER
 * - 已有完成请求进行中 → IN_PROGRESS（防重复点击/并发提交）
 * - COMPLETED → TRIP_ALREADY_COMPLETED
 * - DRAFT / CANCELLED → TRIP_NOT_ACTIVE
 * - owner + ACTIVE 且无进行中请求 → allowed
 */
export function resolveCompleteTripPermission(
  trip: Pick<Trip, 'creatorId' | 'status'>,
  currentUser: Participant | null | undefined,
  isCompletingTrip: boolean
): CompleteTripPermission {
  if (!isTripOwner(trip, currentUser)) return { allowed: false, reason: 'NOT_OWNER' };
  if (isCompletingTrip) return { allowed: false, reason: 'IN_PROGRESS' };
  if (trip.status === 'COMPLETED') {
    return { allowed: false, reason: 'TRIP_ALREADY_COMPLETED' };
  }
  if (trip.status !== 'ACTIVE') return { allowed: false, reason: 'TRIP_NOT_ACTIVE' };
  return { allowed: true };
}

/** 完成行程流程的依赖注入：页面组装真实实现，测试注入桩函数 */
export interface CompleteTripFlowDeps {
  permission: CompleteTripPermission;
  /** 包装 wx.showModal，resolve 用户是否点了确认 */
  confirm: () => Promise<boolean>;
  /** 包装 tripService.completeTrip */
  complete: () => Promise<Trip>;
  onSuccess: (trip: Trip) => void;
  onError: (error: unknown) => void;
}

/**
 * 完成行程整条链路：
 * - 无权限 → 直接 onError(Error(reason))，绝不调 complete
 * - 用户取消 → 直接返回，不调 complete、不触发 onSuccess/onError（取消不做任何事）
 * - 确认 → 调 complete 恰好一次；成功 onSuccess(trip)，失败 onError(error)
 */
export async function runCompleteTripFlow(deps: CompleteTripFlowDeps): Promise<void> {
  if (!deps.permission.allowed) {
    deps.onError(new Error(deps.permission.reason));
    return;
  }

  const confirmed = await deps.confirm();
  if (!confirmed) return;

  try {
    const completed = await deps.complete();
    deps.onSuccess(completed);
  } catch (error) {
    deps.onError(error);
  }
}
