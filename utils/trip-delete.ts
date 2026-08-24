// utils/trip-delete.ts
// 「删除行程」可测逻辑层：显隐判定 + 权限判定 + 二次确认文案 + 依赖注入流程执行器。
// 与 utils/trip-complete.ts 同构：页面只组装 deps（wx.showModal / tripService / setData），
// 业务规则全部收敛在此，便于纯 Node 测试覆盖整条链路。
//
// 删除是硬删除（不可恢复）：入口仅 creator 可见（示例行程永不显示），
// 真正的删除动作必须先经过二次确认，且只调用真实后端 DELETE API。

import { Participant } from '../types/participant';
import { Trip } from '../types/trip';
import { isDemoTrip } from './demo-trip';
import { isTripOwner } from './current-user';

/** 二次确认弹窗配置（wx.showModal 参数）；不可恢复语义在正文明确表达 */
export function buildDeleteTripModal(): {
  title: string;
  content: string;
  confirmText: string;
  cancelText: string;
} {
  return {
    title: '删除行程？',
    content: '删除后不可恢复，所有参与者将无法再访问该行程。',
    confirmText: '删除',
    cancelText: '取消',
  };
}

/**
 * 删除入口显隐：creator 且非示例行程才显示。
 * - participant → false（无权删除他人行程）
 * - 示例行程（demo-local-trip）→ false：hydrate 会把 fixture 的 MOCK_SELF_ID 替换为真实用户，
 *   仅按 ownership 判断会误显示，因此必须显式排除 demo。
 */
export function shouldShowDeleteEntry(
  trip: Pick<Trip, 'id' | 'creatorId'> | null | undefined,
  currentUser: Participant | null | undefined
): boolean {
  if (isDemoTrip(trip)) return false;
  return isTripOwner(trip, currentUser);
}

/** 删除权限判定结果：allowed=false 时给出机器可读 reason */
export type DeleteTripPermission =
  | { allowed: true }
  | { allowed: false; reason: 'NOT_OWNER' | 'IN_PROGRESS' };

/**
 * 删除权限判定：
 * - 非 owner（按 id 判断，内部走 isTripOwner，禁止昵称判断）→ NOT_OWNER
 * - 已有删除请求进行中 → IN_PROGRESS（防重复点击/并发提交）
 * - owner 且无进行中请求 → allowed
 */
export function resolveDeleteTripPermission(
  trip: Pick<Trip, 'creatorId'>,
  currentUser: Participant | null | undefined,
  isDeletingTrip: boolean
): DeleteTripPermission {
  if (!isTripOwner(trip, currentUser)) return { allowed: false, reason: 'NOT_OWNER' };
  if (isDeletingTrip) return { allowed: false, reason: 'IN_PROGRESS' };
  return { allowed: true };
}

/** 删除流程的依赖注入：页面组装真实实现，测试注入桩函数 */
export interface DeleteTripFlowDeps {
  permission: DeleteTripPermission;
  /** 包装 wx.showModal，resolve 用户是否点了确认 */
  confirm: () => Promise<boolean>;
  /** 包装 tripService.deleteTrip */
  remove: () => Promise<void>;
  onSuccess: () => void;
  onError: (error: unknown) => void;
}

/**
 * 删除行程整条链路：
 * - 无权限 → 直接 onError(Error(reason))，绝不调 remove
 * - 用户取消 → 直接返回，不调 remove、不触发 onSuccess/onError（取消不做任何事）
 * - 确认 → 调 remove 恰好一次；成功 onSuccess()，失败 onError(error)
 */
export async function runDeleteTripFlow(deps: DeleteTripFlowDeps): Promise<void> {
  if (!deps.permission.allowed) {
    deps.onError(new Error(deps.permission.reason));
    return;
  }

  const confirmed = await deps.confirm();
  if (!confirmed) return;

  try {
    await deps.remove();
    deps.onSuccess();
  } catch (error) {
    deps.onError(error);
  }
}
