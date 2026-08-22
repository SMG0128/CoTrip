// tests/trip-complete.test.ts
// 完成行程逻辑层测试：权限判定、弹窗文案、依赖注入流程链路（纯 Node，无 wx/Page 依赖）。

import { Participant } from '../types/participant';
import { Trip } from '../types/trip';
import {
  buildCompleteTripModal,
  CompleteTripFlowDeps,
  CompleteTripPermission,
  resolveCompleteTripPermission,
  runCompleteTripFlow,
} from '../utils/trip-complete';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`断言失败: ${message}`);
}

/** 断言权限结果为不允许且 reason 匹配 */
function expectReason(
  permission: CompleteTripPermission,
  reason: string,
  message: string
): void {
  assert(!permission.allowed && permission.reason === reason, message);
}

function participantFixture(id: string): Participant {
  return { id, nickname: `用户_${id}` };
}

function tripFixture(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip_1',
    title: '顺德一日游',
    status: 'ACTIVE',
    creatorId: 'usr_owner',
    participantIds: ['usr_owner', 'usr_guest'],
    createdAt: '2026-08-20T10:00:00.000Z',
    initialBrief: '周末去顺德吃东西',
    commentIds: [],
    constraintIds: [],
    ...overrides,
  };
}

function completedTripFixture(): Trip {
  return tripFixture({ status: 'COMPLETED', completedAt: '2026-08-21T10:00:00.000Z' });
}

/** 流程探针：记录 complete/onSuccess/onError 调用情况 */
interface FlowProbe {
  completeCalls: number;
  successTrips: Trip[];
  errors: unknown[];
}

/** 构造可配置的 flow deps + 探针（默认：allowed、确认、成功返回 COMPLETED Trip） */
function buildDeps(
  options: {
    permission?: CompleteTripPermission;
    confirmResult?: boolean;
    rejectComplete?: boolean;
  } = {}
): { deps: CompleteTripFlowDeps; probe: FlowProbe } {
  const probe: FlowProbe = { completeCalls: 0, successTrips: [], errors: [] };
  const deps: CompleteTripFlowDeps = {
    permission: options.permission ?? { allowed: true },
    confirm: async () => options.confirmResult ?? true,
    complete: async (): Promise<Trip> => {
      probe.completeCalls += 1;
      if (options.rejectComplete) throw new Error('backend down');
      return completedTripFixture();
    },
    onSuccess: (trip) => probe.successTrips.push(trip),
    onError: (error) => probe.errors.push(error),
  };
  return { deps, probe };
}

export async function runTripCompleteTests(): Promise<void> {
  const owner = participantFixture('usr_owner');
  const guest = participantFixture('usr_guest');

  // ---- 权限判定 ----
  assert(
    resolveCompleteTripPermission(tripFixture(), owner, false).allowed,
    'owner + ACTIVE 应允许完成行程'
  );

  // 非 owner（即使是参与者身份）→ NOT_OWNER，且流程全程不调 complete
  const guestPerm = resolveCompleteTripPermission(tripFixture(), guest, false);
  expectReason(guestPerm, 'NOT_OWNER', '非 owner 必须 NOT_OWNER');
  const notOwnerFlow = buildDeps({ permission: guestPerm });
  await runCompleteTripFlow(notOwnerFlow.deps);
  assert(notOwnerFlow.probe.completeCalls === 0, 'NOT_OWNER 时绝不能调 complete');
  assert(
    notOwnerFlow.probe.errors.length === 1 &&
      (notOwnerFlow.probe.errors[0] as Error).message === 'NOT_OWNER',
    'NOT_OWNER 必须走 onError(Error(NOT_OWNER))'
  );
  assert(notOwnerFlow.probe.successTrips.length === 0, 'NOT_OWNER 不能触发 onSuccess');

  // 防重复：请求进行中 → IN_PROGRESS，不调 complete
  const inProgressPerm = resolveCompleteTripPermission(tripFixture(), owner, true);
  expectReason(inProgressPerm, 'IN_PROGRESS', '进行中必须 IN_PROGRESS（防重复点击）');
  const inProgressFlow = buildDeps({ permission: inProgressPerm });
  await runCompleteTripFlow(inProgressFlow.deps);
  assert(inProgressFlow.probe.completeCalls === 0, 'IN_PROGRESS 时不能调 complete');

  // 状态门禁：COMPLETED / DRAFT / CANCELLED 均拒绝
  expectReason(
    resolveCompleteTripPermission(completedTripFixture(), owner, false),
    'TRIP_ALREADY_COMPLETED',
    '已完成行程必须 TRIP_ALREADY_COMPLETED'
  );
  expectReason(
    resolveCompleteTripPermission(tripFixture({ status: 'DRAFT' }), owner, false),
    'TRIP_NOT_ACTIVE',
    'DRAFT 必须 TRIP_NOT_ACTIVE'
  );
  expectReason(
    resolveCompleteTripPermission(tripFixture({ status: 'CANCELLED' }), owner, false),
    'TRIP_NOT_ACTIVE',
    'CANCELLED 必须 TRIP_NOT_ACTIVE'
  );

  // ---- 二次确认弹窗文案 ----
  const modal = buildCompleteTripModal();
  assert(modal.title === '完成行程', '弹窗 title 应为「完成行程」');
  assert(
    modal.content === '完成后，该行程将从「正在进行」移入「历史行程」。确定要完成吗？',
    '弹窗 content 与规格不一致'
  );
  assert(modal.confirmText === '完成', '弹窗 confirmText 应为「完成」');
  assert(modal.cancelText === '再等等', '弹窗 cancelText 应为「再等等」');

  // ---- 流程：用户取消 → 不调 complete、不触发 onSuccess/onError ----
  const cancelFlow = buildDeps({ confirmResult: false });
  await runCompleteTripFlow(cancelFlow.deps);
  assert(cancelFlow.probe.completeCalls === 0, '取消时不能调 complete');
  assert(
    cancelFlow.probe.successTrips.length === 0 && cancelFlow.probe.errors.length === 0,
    '取消不做任何事：不触发 onSuccess/onError'
  );

  // ---- 流程：确认成功 → complete 恰好一次，onSuccess 收到返回的 Trip ----
  const confirmFlow = buildDeps({ confirmResult: true });
  await runCompleteTripFlow(confirmFlow.deps);
  assert(confirmFlow.probe.completeCalls === 1, '确认后 complete 恰好调用一次');
  assert(
    confirmFlow.probe.successTrips.length === 1 &&
      confirmFlow.probe.successTrips[0].id === completedTripFixture().id &&
      confirmFlow.probe.successTrips[0].status === 'COMPLETED',
    'onSuccess 必须收到 complete 返回的已完成 Trip'
  );
  assert(confirmFlow.probe.errors.length === 0, '成功路径不得触发 onError');

  // ---- 流程：complete 失败 → onError 触发且 onSuccess 未触发 ----
  const rejectFlow = buildDeps({ rejectComplete: true });
  await runCompleteTripFlow(rejectFlow.deps);
  assert(rejectFlow.probe.completeCalls === 1, '失败路径 complete 也应被调用过一次');
  assert(rejectFlow.probe.successTrips.length === 0, '失败时不得触发 onSuccess');
  assert(rejectFlow.probe.errors.length === 1, '失败必须走 onError');

  console.log('✅ trip-complete.test.ts 全部通过');
}
