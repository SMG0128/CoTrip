// tests/trip-delete.test.ts
// 删除行程逻辑层测试：入口显隐（creator/participant/Mock）、弹窗文案、
// 二次确认链路、防重复提交与失败不假删除（纯 Node，无 wx/Page 依赖）。

import { Participant } from '../types/participant';
import { Trip } from '../types/trip';
import { DEMO_TRIP_ID } from '../utils/demo-trip';
import {
  buildDeleteTripModal,
  DeleteTripFlowDeps,
  DeleteTripPermission,
  resolveDeleteTripPermission,
  runDeleteTripFlow,
  shouldShowDeleteEntry,
} from '../utils/trip-delete';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`断言失败: ${message}`);
}

/** 断言权限结果为不允许且 reason 匹配 */
function expectReason(
  permission: DeleteTripPermission,
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

/** 流程探针：记录 confirm/remove 调用顺序与 onSuccess/onError 触发情况 */
interface FlowProbe {
  confirmCalls: number;
  removeCalls: number;
  events: string[];
}

/** 构造可配置的 flow deps + 探针（默认：allowed、确认、成功 resolve） */
function buildDeps(
  options: {
    permission?: DeleteTripPermission;
    confirmResult?: boolean;
    rejectRemove?: boolean;
  } = {}
): { deps: DeleteTripFlowDeps; probe: FlowProbe } {
  const probe: FlowProbe = { confirmCalls: 0, removeCalls: 0, events: [] };
  const deps: DeleteTripFlowDeps = {
    permission: options.permission ?? { allowed: true },
    confirm: async (): Promise<boolean> => {
      probe.confirmCalls += 1;
      probe.events.push('confirm');
      return options.confirmResult ?? true;
    },
    remove: async (): Promise<void> => {
      probe.removeCalls += 1;
      probe.events.push('remove');
      if (options.rejectRemove) throw new Error('backend down');
    },
    onSuccess: () => probe.events.push('success'),
    onError: (error) => probe.events.push(`error:${(error as Error).message}`),
  };
  return { deps, probe };
}

export async function runTripDeleteTests(): Promise<void> {
  const owner = participantFixture('usr_owner');
  const guest = participantFixture('usr_guest');

  // ---- 入口显隐：creator 显示 ----
  assert(shouldShowDeleteEntry(tripFixture(), owner), 'creator 必须显示删除入口');

  // participant 不显示；非参与者也不显示
  assert(!shouldShowDeleteEntry(tripFixture(), guest), 'participant 不得显示删除入口');
  assert(
    !shouldShowDeleteEntry(tripFixture({ creatorId: 'usr_other' }), owner),
    'creatorId 不是当前用户时不得显示删除入口'
  );
  assert(
    !shouldShowDeleteEntry(
      tripFixture({ creatorId: 'usr_other', participantIds: ['usr_owner'] }),
      owner
    ),
    '仅是 participant 不是 creator 时不得显示删除入口'
  );

  // Mock Demo Trip 不显示：即使 hydrate 后 ownership 命中（fixture creatorId 被替换为真实用户）
  assert(
    !shouldShowDeleteEntry(tripFixture({ id: DEMO_TRIP_ID, creatorId: 'usr_owner' }), owner),
    '示例行程（demo-local-trip）永不显示删除入口'
  );

  // ---- 权限判定 ----
  assert(
    resolveDeleteTripPermission(tripFixture(), owner, false).allowed,
    'owner 应允许删除行程'
  );
  expectReason(
    resolveDeleteTripPermission(tripFixture(), guest, false),
    'NOT_OWNER',
    '非 owner 必须 NOT_OWNER'
  );

  // 防重复提交：请求进行中 → IN_PROGRESS，不调 remove
  expectReason(
    resolveDeleteTripPermission(tripFixture(), owner, true),
    'IN_PROGRESS',
    '进行中必须 IN_PROGRESS（防重复点击/并发提交）'
  );
  const inProgressFlow = buildDeps({
    permission: resolveDeleteTripPermission(tripFixture(), owner, true),
  });
  await runDeleteTripFlow(inProgressFlow.deps);
  assert(inProgressFlow.probe.removeCalls === 0, 'IN_PROGRESS 时不能调 remove');
  assert(inProgressFlow.probe.confirmCalls === 0, 'IN_PROGRESS 时连确认都不应弹出');
  assert(inProgressFlow.probe.events.includes('error:IN_PROGRESS'), 'IN_PROGRESS 必须走 onError');

  // NOT_OWNER 全程不调 remove
  const notOwnerFlow = buildDeps({
    permission: resolveDeleteTripPermission(tripFixture(), guest, false),
  });
  await runDeleteTripFlow(notOwnerFlow.deps);
  assert(notOwnerFlow.probe.removeCalls === 0, 'NOT_OWNER 时绝不能调 remove');
  assert(notOwnerFlow.probe.events.includes('error:NOT_OWNER'), 'NOT_OWNER 必须走 onError');

  // ---- 二次确认弹窗文案 ----
  const modal = buildDeleteTripModal();
  assert(modal.title === '删除行程？', '弹窗 title 应为「删除行程？」');
  assert(
    modal.content === '删除后不可恢复，所有参与者将无法再访问该行程。',
    '弹窗 content 与规格不一致'
  );
  assert(modal.confirmText === '删除', '弹窗 confirmText 应为「删除」');
  assert(modal.cancelText === '取消', '弹窗 cancelText 应为「取消」');

  // ---- 流程：先确认后请求（confirm 先于 remove）----
  const orderedFlow = buildDeps();
  await runDeleteTripFlow(orderedFlow.deps);
  assert(orderedFlow.probe.confirmCalls === 1, '确认必须恰好调用一次且先于请求');
  assert(
    orderedFlow.probe.events.join(',') === 'confirm,remove,success',
    `事件顺序必须为 确认→请求→成功，实际 ${orderedFlow.probe.events.join(',')}`
  );

  // ---- 流程：取消 → 不请求 API、不做任何事 ----
  const cancelFlow = buildDeps({ confirmResult: false });
  await runDeleteTripFlow(cancelFlow.deps);
  assert(cancelFlow.probe.removeCalls === 0, '取消时不能调 remove（不发 DELETE API）');
  assert(
    !cancelFlow.probe.events.some((e) => e.startsWith('success') || e.startsWith('error')),
    '取消不做任何事：不触发 onSuccess/onError'
  );

  // ---- 流程：确认成功 → remove 恰好一次，onSuccess 恰好一次 ----
  const confirmFlow = buildDeps({ confirmResult: true });
  await runDeleteTripFlow(confirmFlow.deps);
  assert(confirmFlow.probe.removeCalls === 1, '确认后 remove 恰好调用一次');
  assert(
    confirmFlow.probe.events.filter((e) => e === 'success').length === 1,
    '成功路径 onSuccess 必须恰好触发一次（页面在此 toast 并返回首页）'
  );

  // ---- 流程：API 失败 → 不假删除：onError 触发、onSuccess 未触发 ----
  const rejectFlow = buildDeps({ rejectRemove: true });
  await runDeleteTripFlow(rejectFlow.deps);
  assert(rejectFlow.probe.removeCalls === 1, '失败路径 remove 也应被调用过一次');
  assert(
    !rejectFlow.probe.events.includes('success'),
    'API 失败时不得触发 onSuccess（绝不本地假装删除成功）'
  );
  assert(
    rejectFlow.probe.events.includes('error:backend down'),
    '失败必须走 onError（页面留在本页并提示错误，可重试）'
  );

  console.log('✅ trip-delete.test.ts 全部通过');
}
