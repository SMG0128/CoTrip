// tests/ai-ui-config.test.ts
// AI UI 语义配置前端消费层测试。
//
// 覆盖：
// - 版本过期的提示必须被忽略（不能把旧版本的「已更新」贴到新计划上）
// - 缺失 / 异常字段防御式降级为安全空值，绝不抛错
// - 事件标记只输出布尔语义，绝不输出样式
// - 前后端镜像类型字段集合一致（schema drift 守卫）

import {
  AIUIConfig,
  TripLatestAIUI,
  emptyAIUIConfig,
} from '../types/ai-envelope';
import { Plan } from '../types/plan';
import { Trip } from '../types/trip';
import { buildEventUIFlags, resolveAIUIViewModel } from '../utils/ai-ui-config';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`❌ ${message}`);
}

function planFixture(version: number): Plan {
  return {
    id: `plan_trip_T_v${version}`,
    tripId: 'trip_T',
    version,
    events: [
      {
        id: 'event_a',
        type: 'SPORT',
        title: '羽毛球',
        time: { start: '2026-09-05T15:00:00+08:00', timezone: 'Asia/Shanghai' },
      },
      {
        id: 'event_b',
        type: 'DINING',
        title: '晚餐',
        time: { start: '2026-09-05T18:00:00+08:00', timezone: 'Asia/Shanghai' },
      },
    ],
    satisfiedConstraintCount: 0,
    totalConstraintCount: 0,
    conflicts: [],
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

function latestAIUI(planVersion: number, ui?: Partial<AIUIConfig>): TripLatestAIUI {
  return {
    planVersion,
    requestType: 'TRIP_UPDATE',
    ui: { ...emptyAIUIConfig(), ...ui },
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

type TripUIInput = Pick<Trip, 'currentPlan' | 'latestAIUI'>;

// ---- 版本匹配 ----

{
  const trip: TripUIInput = {
    currentPlan: planFixture(2),
    latestAIUI: latestAIUI(2, { changedEventIds: ['event_b'], message: '晚餐已改为粤菜' }),
  };
  const vm = resolveAIUIViewModel(trip);
  assert(vm.isCurrent, 'planVersion 匹配时提示必须生效');
  assert(vm.changedEventIds.length === 1 && vm.changedEventIds[0] === 'event_b', '变化条目必须透传');
  assert(vm.message === '晚餐已改为粤菜', 'message 必须透传');
  assert(vm.hasMessage, 'hasMessage 必须为 true');
}

{
  // 提示来自 v1，但当前计划已经是 v2 → 必须忽略，避免误标
  const trip: TripUIInput = {
    currentPlan: planFixture(2),
    latestAIUI: latestAIUI(1, { changedEventIds: ['event_b'], message: '过期提示' }),
  };
  const vm = resolveAIUIViewModel(trip);
  assert(!vm.isCurrent, '版本过期的提示必须失效');
  assert(vm.changedEventIds.length === 0, '过期提示不得标记任何条目');
  assert(vm.message === null, '过期提示不得展示消息');
}

// ---- 防御式降级 ----

{
  assert(!resolveAIUIViewModel({}).isCurrent, '无计划无提示时必须安全空值');
  assert(
    !resolveAIUIViewModel({ currentPlan: planFixture(1) }).isCurrent,
    '缺少 latestAIUI 时必须安全空值',
  );
  assert(
    !resolveAIUIViewModel({ latestAIUI: latestAIUI(1) }).isCurrent,
    '缺少 currentPlan 时必须安全空值',
  );
}

{
  // 服务端已做强校验，前端仍需对异常结构防御，绝不抛错阻断页面
  const trip = {
    currentPlan: planFixture(1),
    latestAIUI: {
      planVersion: 1,
      requestType: 'TRIP_UPDATE',
      ui: { changedEventIds: ['ok', 3, '  '], highlightEventIds: null, message: '   ' },
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
  } as unknown as TripUIInput;
  const vm = resolveAIUIViewModel(trip);
  assert(vm.changedEventIds.length === 1 && vm.changedEventIds[0] === 'ok', '非法 id 必须被过滤');
  assert(vm.highlightEventIds.length === 0, '非数组字段必须降级为空数组');
  assert(vm.message === null, '空白 message 必须降级为 null');
  assert(!vm.hasMessage, 'hasMessage 必须随 message 降级');
}

// ---- 事件标记只输出布尔语义 ----

{
  const plan = planFixture(2);
  const vm = resolveAIUIViewModel({
    currentPlan: plan,
    latestAIUI: latestAIUI(2, { changedEventIds: ['event_b'], highlightEventIds: ['event_a'] }),
  });
  const flags = buildEventUIFlags(plan, vm);
  assert(flags.length === 2, '每个事件都必须有标记');
  assert(flags[0].id === 'event_a' && flags[0].aiHighlighted && !flags[0].aiChanged, 'event_a 应为高亮');
  assert(flags[1].id === 'event_b' && flags[1].aiChanged && !flags[1].aiHighlighted, 'event_b 应为已变化');

  const keys = Object.keys(flags[0]).sort();
  assert(
    JSON.stringify(keys) === JSON.stringify(['aiChanged', 'aiHighlighted', 'id']),
    '事件标记只能包含布尔语义字段，绝不能包含任何样式值',
  );

  assert(buildEventUIFlags(undefined, vm).length === 0, '无计划时标记为空');
}

// ---- schema drift 守卫（与 server/src/types/ai-envelope.ts 对齐）----

{
  const keys = Object.keys(emptyAIUIConfig()).sort();
  assert(
    JSON.stringify(keys)
      === JSON.stringify(['changedEventIds', 'highlightEventIds', 'message', 'removedEventIds']),
    'AIUIConfig 字段集合必须与 server/src/types/ai-envelope.ts 保持一致',
  );

  // 样式字段绝不允许出现在契约里
  for (const forbidden of ['color', 'style', 'className', 'fontSize', 'icon', 'image']) {
    assert(
      !keys.includes(forbidden),
      `AIUIConfig 不得包含样式字段 ${forbidden}（视觉由前端决定）`,
    );
  }

  const latestKeys = Object.keys(latestAIUI(1)).sort();
  assert(
    JSON.stringify(latestKeys)
      === JSON.stringify(['planVersion', 'requestType', 'ui', 'updatedAt']),
    'TripLatestAIUI 字段集合必须与服务端保持一致',
  );

  // Plan 镜像：服务端 TripPlan 落库字段必须能被前端 Plan 承载
  const plan = planFixture(1);
  for (const field of [
    'id',
    'tripId',
    'version',
    'events',
    'satisfiedConstraintCount',
    'totalConstraintCount',
    'conflicts',
    'updatedAt',
  ]) {
    assert(field in plan, `Plan 必须包含服务端 TripPlan 字段 ${field}`);
  }
}

console.log('✅ ai-ui-config.test.ts 全部通过');
