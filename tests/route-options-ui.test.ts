// tests/route-options-ui.test.ts
// 「我的推荐」路线方案选择器 UI 层测试：手风琴状态机 + 展示文案格式化 + 导航目标解析
// + 错误码→中文文案映射（纯 Node，无 wx / Page 依赖）。
// 注意：由主线统一注册进 tests/run-tests.ts（UI 层不擅自改动测试入口）。

import {
  ResolvedDestination,
  RouteOption,
  RouteStep,
} from '../types/route-option';
import {
  extractNavigateTarget,
  formatIsoTimeShort,
  formatRouteArrivalFooter,
  formatRouteDistance,
  formatRouteModesLine,
  formatRouteScheduleLine,
  formatRouteStepDesc,
  resolveNextExpandedIndex,
  resolveRouteErrorText,
  routeModeLabel,
  routeStepTypeLabel,
} from '../utils/route-options-ui';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`断言失败: ${message}`);
}

function stepFixture(overrides: Partial<RouteStep> = {}): RouteStep {
  return {
    type: 'WALK',
    title: '当前位置',
    ...overrides,
  };
}

function optionFixture(overrides: Partial<RouteOption> = {}): RouteOption {
  return {
    id: 'route_1',
    recommended: true,
    durationMinutes: 51,
    departureTime: '2026-08-22T10:36:00+08:00',
    arrivalTime: '2026-08-22T11:27:00+08:00',
    estimatedCost: { amount: 6, currency: 'CNY' },
    modes: ['WALK', 'METRO', 'WALK'],
    steps: [
      stepFixture({ title: '当前位置', durationMinutes: 8, distanceMeters: 600 }),
      stepFixture({
        type: 'TRANSIT',
        title: '体育西路',
        subtitle: '地铁 3 号线',
        durationMinutes: 42,
      }),
      stepFixture({
        type: 'ARRIVAL',
        title: '广州羽毛球中心羽毛球馆',
        latitude: 23.121,
        longitude: 113.323,
      }),
    ],
    ...overrides,
  };
}

/** 模拟页面手风琴交互：返回点击后的展开索引 */
function click(currentExpanded: number | null, clickedIndex: number): number {
  return resolveNextExpandedIndex(currentExpanded, clickedIndex);
}

export async function runRouteOptionsUiTests(): Promise<void> {
  // ---- 手风琴状态机：初始展开 ----
  // 1 条方案 → 初始展开第 0 条
  assert(click(null, 0) === 0, '1 条方案时初始应展开第 0 条');
  // 3 条方案 → 初始同样展开第 0 条（页面初始 expandedRouteIndex=0）
  assert(click(null, 0) === 0, '3 条方案时初始也应展开第 0 条');
  assert(resolveNextExpandedIndex(null, 2) === 2, 'null 状态点击第 2 条必须展开第 2 条');

  // ---- 手风琴状态机：切换展开 ----
  assert(click(0, 1) === 1, 'click(1) 后应展开第 1 条（第 0 条自动收起）');
  assert(click(1, 2) === 2, 'click(2) 后应展开第 2 条（第 1 条自动收起）');
  assert(click(2, 0) === 0, 'click(0) 后应回到第 0 条');

  // ---- 手风琴状态机：点已展开项保持不变（不允许收起成空态） ----
  assert(click(0, 0) === 0, '点已展开的第 0 条必须保持展开');
  assert(click(1, 1) === 1, '点已展开的第 1 条必须保持展开');
  assert(click(2, 2) === 2, '点已展开的第 2 条必须保持展开');

  // ---- 不变量：任意点击序列下，同一时刻只有一个展开且永不为 null ----
  // 单值索引状态天然满足「只有一个展开」，此处对任意序列显式断言：
  // 每步之后状态必须是 [0, 3) 内的整数（非 null）且等于刚点击的索引。
  let state: number | null = null;
  for (let i = 0; i < 200; i += 1) {
    const clicked = (i * 7 + 3) % 3;
    state = click(state, clicked);
    assert(state !== null, `序列第 ${i} 步后展开索引不得为 null（至少恒有一条展开）`);
    assert(
      Number.isInteger(state) && state >= 0 && state < 3,
      `序列第 ${i} 步后展开索引 ${state} 必须是合法方案索引`
    );
    assert(
      state === clicked,
      `序列第 ${i} 步后唯一展开项必须是刚点击的第 ${clicked} 条`
    );
  }

  // ---- 摘要卡文案：modes 中文连接（去重保序） ----
  assert(routeModeLabel('METRO') === '地铁', 'METRO 必须映射为「地铁」');
  assert(routeModeLabel('WALK') === '步行', 'WALK 必须映射为「步行」');
  assert(
    formatRouteModesLine(['WALK', 'METRO', 'WALK']) === '步行 + 地铁',
    'modes 必须去重保序并以「 + 」连接'
  );
  assert(formatRouteModesLine([]) === '', '空 modes 应输出空串');

  // ---- 摘要卡文案：第三行「10:36 → 11:27 · 约 ¥6」 ----
  assert(
    formatRouteScheduleLine(optionFixture()) === '10:36 → 11:27 · 约 ¥6',
    '完整时间+票价应输出「10:36 → 11:27 · 约 ¥6」'
  );
  assert(
    formatRouteScheduleLine(optionFixture({ estimatedCost: undefined })) === '10:36 → 11:27',
    '缺票价时应只显示时间段'
  );
  assert(
    formatRouteScheduleLine(optionFixture({ departureTime: undefined, arrivalTime: undefined })) ===
      '— → — · 约 ¥6',
    '缺时间应显示「—」占位，不猜测时间'
  );
  assert(formatIsoTimeShort(undefined) === '—', 'undefined 时间必须显示「—」');
  // 回归：数据层推算输出 UTC（Z 结尾），展示必须换算到东八区，不得直接切片（否则 -8h）
  assert(
    formatIsoTimeShort('2026-08-22T02:36:00.000Z') === '10:36',
    'UTC 时刻必须换算为东八区展示'
  );
  assert(
    formatRouteArrivalFooter('2026-08-22T11:27:00+08:00') === '11:27 到达',
    '到达行应输出「11:27 到达」'
  );
  assert(formatRouteArrivalFooter(undefined) === '预计到达', '缺到达时间应退化为「预计到达」');

  // ---- 时间轴步骤说明 ----
  assert(routeStepTypeLabel('TRANSIT') === '乘车', 'TRANSIT 必须映射为「乘车」');
  assert(
    formatRouteStepDesc(stepFixture({ durationMinutes: 8, distanceMeters: 600 })) ===
      '步行 · 8 分钟 · 600 米',
    '步骤说明应组合类型/时长/距离'
  );
  assert(formatRouteDistance(1500) === '1.5 公里', '≥1km 距离应以公里显示');
  assert(formatRouteDistance(600) === '600 米', '<1km 距离应以米显示');

  // ---- 去导航目标解析：最后带坐标 step 优先 ----
  const target = extractNavigateTarget(optionFixture());
  assert(
    !!target && target.name === '广州羽毛球中心羽毛球馆' && target.latitude === 23.121,
    '应取最后一个带坐标 step 作为导航目标'
  );
  const noCoordOption = optionFixture({
    steps: [stepFixture({ title: '当前位置' }), stepFixture({ title: '目的地' })],
  });
  const resolved: ResolvedDestination = {
    name: '广州羽毛球中心羽毛球馆',
    latitude: 23.1,
    longitude: 113.3,
  };
  const fallbackTarget = extractNavigateTarget(noCoordOption, resolved);
  assert(
    !!fallbackTarget && fallbackTarget.name === '广州羽毛球中心羽毛球馆',
    'steps 无坐标时应回退 resolvedDestination'
  );
  assert(
    extractNavigateTarget(noCoordOption, null) === null,
    'steps 与 resolvedDestination 均无坐标时必须返回 null（绝不伪造坐标）'
  );

  // ---- 错误码 → 中文文案映射 ----
  assert(resolveRouteErrorText({ code: 'NOT_CONFIGURED' }) === '暂未配置地图服务', 'NOT_CONFIGURED 文案');
  assert(resolveRouteErrorText({ code: 'GEOCODE_FAILED' }) === '暂时无法定位这个地点', 'GEOCODE_FAILED 文案');
  assert(resolveRouteErrorText({ code: 'NO_ROUTE' }) === '暂无可达路线', 'NO_ROUTE 文案');
  assert(
    resolveRouteErrorText({ code: 'PERMISSION_DENIED' }) === '暂时无法规划路线，稍后重试',
    'PERMISSION_DENIED 走通用文案'
  );
  assert(
    resolveRouteErrorText({ code: 'LOCATION_UNAVAILABLE' }) === '暂时无法规划路线，稍后重试',
    'LOCATION_UNAVAILABLE 走通用文案'
  );
  assert(
    resolveRouteErrorText({ code: 'NETWORK_ERROR' }) === '暂时无法规划路线，稍后重试',
    'NETWORK_ERROR 走通用文案'
  );
  assert(
    resolveRouteErrorText({ code: 'PROVIDER_ERROR' }) === '暂时无法规划路线，稍后重试',
    'PROVIDER_ERROR 走通用文案'
  );
  assert(
    resolveRouteErrorText(new Error('boom')) === '暂时无法规划路线，稍后重试',
    '未知错误必须走通用文案，绝不崩溃'
  );

  console.log('✅ route-options-ui.test.ts 全部通过');
}
