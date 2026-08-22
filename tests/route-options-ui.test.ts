// tests/route-options-ui.test.ts
// 「我的推荐」路线方案选择器 UI 层测试：
// 手风琴状态机 + Route Picker 行/腿视图模型 + 折叠态摘要分段链（按真实 leg 顺序）
// + 线路名展示归一化 + 导航目标解析 + 错误码→中文文案
// （纯 Node，无 wx / Page 依赖）。
// 注意：由主线统一注册进 tests/run-tests.ts（UI 层不擅自改动测试入口）。

import {
  ResolvedDestination,
  RouteOption,
  RouteStep,
} from '../types/route-option';
import {
  RouteRowView,
  buildCompactRouteSummary,
  buildRouteDetailVM,
  buildRouteLabelText,
  buildRouteLeg,
  buildRouteLegs,
  buildRouteRowVMs,
  extractNavigateTarget,
  formatIsoTimeShort,
  formatRouteArrivalFooter,
  formatRouteCost,
  formatRouteDistance,
  formatRouteDuration,
  formatRouteStepDesc,
  buildRouteSummarySegments,
  formatTransitLineLabel,
  getRouteModeIcon,
  resolveNextExpandedIndex,
  resolveRouteErrorText,
  routeModeLabel,
  routeStepTypeLabel,
} from '../utils/route-options-ui';
import { mockRouteOptions } from '../mock/mock-route-options';

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
        lineTitle: '地铁 3 号线',
        subtitle: '地铁 3 号线',
        transportMode: 'METRO',
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

/** 模拟页面手风琴交互：返回点击后的展开索引（null = 全部收起） */
function click(currentExpanded: number | null, clickedIndex: number): number | null {
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

  // ---- 手风琴状态机：点已展开项 → 全部收起（允许 0 条展开） ----
  assert(click(0, 0) === null, '点已展开的第 0 条必须全部收起');
  assert(click(1, 1) === null, '点已展开的第 1 条必须全部收起');
  assert(click(2, 2) === null, '点已展开的第 2 条必须全部收起');

  // 收起后可重新展开
  assert(click(null, 0) === 0, '全部收起后再点第 0 条应重新展开第 0 条');
  assert(click(null, 1) === 1, '全部收起后点击第 1 条应展开第 1 条');

  // 完整交互序列：初始展开 → 收起 → 重展 → 切换 → 收起
  let seq: number | null = click(null, 0);
  assert(seq === 0, '初始应展开第 0 条');
  seq = click(seq, 0);
  assert(seq === null, '点击当前展开项后应全部收起');
  seq = click(seq, 0);
  assert(seq === 0, '再次点击第 0 条应重新展开');
  seq = click(seq, 1);
  assert(seq === 1, '点击第 1 条应收起第 0 条并展开第 1 条');
  seq = click(seq, 1);
  assert(seq === null, '再点第 1 条应全部收起');

  // ---- 不变量：任意点击序列下，同一时刻最多一条展开，且允许 0 条 ----
  // 单值索引状态天然满足「最多一个展开」；此处对任意序列显式断言：
  // 每步之后状态 ∈ {null, 0, 1, 2}（null = 全部收起；整数 = 唯一展开且等于刚点击项）。
  let state: number | null = null;
  for (let i = 0; i < 200; i += 1) {
    const clicked = (i * 7 + 3) % 3;
    state = click(state, clicked);
    const valid =
      state === null ||
      (Number.isInteger(state) && state >= 0 && state < 3 && state === clicked);
    assert(
      valid,
      `序列第 ${i} 步后展开状态 ${state} 必须为 null（全收起）或等于刚点击的合法索引`
    );
    // 显式断言 expanded ∈ {null, 0, 1, 2}
    assert(
      state === null || state === 0 || state === 1 || state === 2,
      `序列第 ${i} 步后展开索引必须属于 {null, 0, 1, 2}`
    );
  }

  // ---- 交通模式 / 步骤类型标签 ----
  assert(routeModeLabel('METRO') === '地铁', 'METRO 必须映射为「地铁」');
  assert(routeModeLabel('WALK') === '步行', 'WALK 必须映射为「步行」');
  assert(routeStepTypeLabel('TRANSIT') === '乘车', 'TRANSIT 必须映射为「乘车」');

  // ---- 时刻格式化：东八区换算 + 缺失占位 ----
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
  assert(formatRouteArrivalFooter(undefined) === '预计到达', '缺到达时间应退化为「预计到达」，绝不编造时刻');

  // ---- 步骤说明 / 距离 ----
  assert(
    formatRouteStepDesc(stepFixture({ durationMinutes: 8, distanceMeters: 600 })) ===
      '步行 · 8 分钟 · 600 米',
    '步骤说明应组合类型/时长/距离'
  );
  assert(formatRouteDistance(1500) === '1.5 公里', '≥1km 距离应以公里显示');
  assert(formatRouteDistance(600) === '600 米', '<1km 距离应以米显示');

  // ---- 去导航目标解析：最后带坐标 step 优先，其次 resolvedDestination ----
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

  // ---- 模式图标映射（图标只属于 Travel Legs） ----
  assert(getRouteModeIcon('WALK') === '/assets/icons/route/walk.svg', 'WALK 必须映射步行图标');
  assert(getRouteModeIcon('METRO') === '/assets/icons/route/metro.svg', 'METRO 必须映射地铁图标');
  assert(getRouteModeIcon('BUS') === '/assets/icons/route/bus.svg', 'BUS 必须映射公交图标');
  assert(
    getRouteModeIcon('TAXI') === '/assets/icons/route/generic.svg' &&
      getRouteModeIcon('DRIVE') === '/assets/icons/route/generic.svg' &&
      getRouteModeIcon('BIKE') === '/assets/icons/route/generic.svg',
    'TAXI/DRIVE/BIKE 回退 generic 图标'
  );

  // ---- 行级标签：三条 route 统一显示「路线 N」（不带 /N）；推荐由 recommended 表达 ----
  assert(buildRouteLabelText(0) === '路线 1', '第 0 条标签统一为「路线 1」（推荐不再占标签位）');
  assert(buildRouteLabelText(1) === '路线 2', '其余条目标签为「路线 N」（不带 /N）');
  assert(buildRouteLabelText(2) === '路线 3', '其余条目标签为「路线 N」（不带 /N）');

  // ---- 行级时长 / 价格（防御式：绝不泄漏 NaN/undefined/--） ----
  assert(formatRouteDuration(51) === '51 分钟', '正常时长输出「N 分钟」');
  assert(formatRouteDuration(undefined) === '', '缺时长输出空串');
  assert(formatRouteDuration(Number.NaN) === '', 'NaN 时长输出空串');
  assert(formatRouteDuration(0) === '', '0 时长视为非法输出空串');
  assert(formatRouteDuration(-5) === '', '负数时长输出空串');
  assert(formatRouteCost({ amount: 6, currency: 'CNY' }) === '¥6', '票价输出「¥N」');
  assert(formatRouteCost(undefined) === '', '缺票价输出空串');
  assert(formatRouteCost({ amount: 0, currency: 'CNY' }) === '', '0 票价视为无票价输出空串');
  assert(formatRouteCost({ amount: Number.NaN, currency: 'CNY' }) === '', 'NaN 票价输出空串');

  // ---- 线路名展示归一化（只做确定性前缀去除，不改 Provider 事实） ----
  assert(formatTransitLineLabel('地铁APM线') === 'APM线', '「地铁APM线」→「APM线」');
  assert(formatTransitLineLabel('地铁1号线') === '1号线', '「地铁1号线」→「1号线」');
  assert(formatTransitLineLabel('地铁 3 号线') === '3 号线', '「地铁 3 号线」→「3 号线」（去前缀并去空格）');
  assert(formatTransitLineLabel('公交810路') === '810路', '「公交810路」→「810路」');
  assert(formatTransitLineLabel(undefined) === '', 'undefined 线路名输出空串');
  assert(formatTransitLineLabel('体育西路') === '体育西路', '非交通前缀线路名保持原样');
  assert(formatTransitLineLabel('地铁') === '地铁', '剥离后为空时保留原值，不输出空串');

  // ---- 折叠态摘要分段链（Route Summary Segments）：按真实 leg 顺序 ----
  // 纯函数契约：WALK 显示真实分腿时长；乘车段只显示线路名（line title 优先于 duration）；
  // 顺序 = Provider 真实 leg 顺序，绝不合并 / 重排。
  const srcOption = optionFixture(); // WALK 8min + METRO 3号线 + ARRIVAL
  const srcSegs = buildRouteSummarySegments(srcOption);
  assert(srcSegs.length === 2, 'WALK + METRO + ARRIVAL → 2 段（跳过 ARRIVAL）');
  assert(srcSegs[0].mode === 'WALK' && srcSegs[0].label === '步行', '首段为步行');
  assert(srcSegs[0].durationText === '8 分钟', '步行段显示真实分腿时长「8 分钟」');
  assert(srcSegs[0].iconUrl === '/assets/icons/route/walk.svg', '步行段使用 walk 图标');
  assert(srcSegs[1].mode === 'METRO' && srcSegs[1].label === '3 号线', '乘车段为归一化线路名');
  assert(srcSegs[1].durationText === '', '乘车段不显示时长（保持 compact，line title 优先）');
  assert(srcSegs[1].iconUrl === '/assets/icons/route/metro.svg', '乘车段使用 metro 图标');

  // WALK + METRO + WALK 三段顺序保持（不合并重复 mode）
  const walkMetroWalk = optionFixture({
    modes: ['WALK', 'METRO', 'WALK'],
    steps: [
      stepFixture({ type: 'WALK', title: '起步', durationMinutes: 8 }),
      stepFixture({
        type: 'TRANSIT',
        title: '地铁 APM 线',
        lineTitle: '地铁 APM 线',
        transportMode: 'METRO',
      }),
      stepFixture({ type: 'WALK', title: '步行至场馆', durationMinutes: 6 }),
    ],
  });
  const wmwSegs = buildRouteSummarySegments(walkMetroWalk);
  assert(wmwSegs.length === 3, 'WALK+METRO+WALK → 3 段');
  assert(
    wmwSegs.map((s) => s.label).join('|') === '步行|APM 线|步行',
    '段顺序必须保持：步行 › APM 线 › 步行'
  );
  assert(
    wmwSegs[0].durationText === '8 分钟' && wmwSegs[2].durationText === '6 分钟',
    '两段步行分别保留各自真实时长'
  );
  assert(
    buildCompactRouteSummary(walkMetroWalk) === '步行 8分钟 › APM 线 › 步行 6分钟',
    '折叠摘要应保留 WALK + METRO + WALK 顺序和真实步行时长'
  );
  const guangzhouWmwSegs = buildRouteSummarySegments(walkMetroWalk, { city: '广州市' });
  assert(
    guangzhouWmwSegs[1].badge?.text === 'APM' &&
      guangzhouWmwSegs[1].badge?.backgroundColor === '#00B5E2',
    '广州上下文的 APM 腿应生成本地青色徽章'
  );
  assert(
    buildCompactRouteSummary(walkMetroWalk, { city: '广州市' }) ===
      '步行 8分钟 › APM › 步行 6分钟',
    '徽章摘要不得重复显示「APM线」'
  );

  // 多换乘链全部按顺序保留（不合并重复 mode、不丢失线路）
  const multiTransit = optionFixture({
    modes: ['WALK', 'METRO', 'WALK', 'METRO', 'WALK'],
    steps: [
      stepFixture({ type: 'WALK', title: 'A', durationMinutes: 5 }),
      stepFixture({ type: 'TRANSIT', title: '地铁 1 号线', lineTitle: '地铁 1 号线', transportMode: 'METRO' }),
      stepFixture({ type: 'WALK', title: 'B', durationMinutes: 3 }),
      stepFixture({ type: 'TRANSIT', title: '地铁 3 号线', lineTitle: '地铁 3 号线', transportMode: 'METRO' }),
      stepFixture({ type: 'WALK', title: 'C', durationMinutes: 7 }),
    ],
  });
  const multiSegs = buildRouteSummarySegments(multiTransit);
  assert(multiSegs.length === 5, '5 段换乘链全部按顺序保留');
  assert(
    multiSegs.map((s) => s.label).join('|') === '步行|1 号线|步行|3 号线|步行',
    '重复 mode 不得合并：1 号线 与 3 号线顺序必须保留'
  );
  assert(
    buildCompactRouteSummary(multiTransit) ===
      '步行 5分钟 › 1 号线 › 步行 3分钟 › 3 号线 › 步行 7分钟',
    '多个乘车腿和中间步行腿不得丢失'
  );

  // BUS：Provider 线路名进入摘要
  const busRoute = optionFixture({
    modes: ['WALK', 'BUS'],
    steps: [
      stepFixture({ type: 'WALK', title: '起步' }),
      stepFixture({
        type: 'TRANSIT',
        title: '公交810路',
        lineTitle: '公交810路',
        transportMode: 'BUS',
      }),
    ],
  });
  const busSegs = buildRouteSummarySegments(busRoute);
  assert(busSegs[1].mode === 'BUS' && busSegs[1].label === '810路', '公交段使用 Provider 线路名「810路」');
  assert(busSegs[1].iconUrl === '/assets/icons/route/bus.svg', '公交段使用 bus 图标');
  assert(
    busSegs[1].badge?.text === '810' && busSegs[1].badge?.foregroundColor === '#FFFFFF',
    '公交摘要使用 Provider 线路名生成蓝底白字 badge'
  );

  const walkBusWalk = optionFixture({
    modes: ['WALK', 'BUS', 'WALK'],
    steps: [
      stepFixture({ type: 'WALK', title: '起步', durationMinutes: 4 }),
      stepFixture({ type: 'TRANSIT', title: 'B3', lineTitle: 'B3', transportMode: 'BUS' }),
      stepFixture({ type: 'WALK', title: '到达前步行', durationMinutes: 6 }),
    ],
  });
  assert(
    buildCompactRouteSummary(walkBusWalk) === '步行 4分钟 › B3 › 步行 6分钟',
    '折叠摘要应保留 WALK + BUS + WALK 顺序和 Provider 公交线路名'
  );

  // 纯步行：合并为单个总时长段（无换乘顺序可表达，快览总时长）
  const walkOnly = optionFixture({
    modes: ['WALK'],
    steps: [
      stepFixture({ type: 'WALK', title: '起步', durationMinutes: 3 }),
      stepFixture({ type: 'WALK', title: '中途', durationMinutes: 4 }),
      stepFixture({ type: 'WALK', title: '终点', durationMinutes: 2 }),
    ],
  });
  const walkOnlySegs = buildRouteSummarySegments(walkOnly);
  assert(walkOnlySegs.length === 1, '纯步行合并为 1 段');
  assert(
    walkOnlySegs[0].label === '步行' && walkOnlySegs[0].durationText === '51 分钟',
    '纯步行显示总时长「51 分钟」（来自方案真实总时长）'
  );
  assert(buildCompactRouteSummary(walkOnly) === '步行 51分钟', '纯步行紧凑摘要使用真实总时长');

  // 缺失时长：安全退化为「步行」，绝不输出「undefined 分钟」
  const noDurSegs = buildRouteSummarySegments(
    optionFixture({
      steps: [
        stepFixture({ type: 'WALK', title: '起步' }),
        stepFixture({ type: 'TRANSIT', title: '地铁 1 号线', lineTitle: '地铁 1 号线', transportMode: 'METRO' }),
        stepFixture({ type: 'WALK', title: '步行至场馆' }),
      ],
    })
  );
  assert(noDurSegs.length === 3, '缺时长链仍保持 3 段');
  assert(
    noDurSegs[0].label === '步行' && noDurSegs[0].durationText === '',
    '缺时长步行段不带时长'
  );
  assert(noDurSegs[2].durationText === '', '末段缺时长同样退化');
  assert(noDurSegs[0].durationText.indexOf('undefined') === -1, '绝不泄漏 undefined 到文案');
  assert(
    buildCompactRouteSummary(optionFixture({ steps: [stepFixture({ type: 'WALK' }), stepFixture({ type: 'TRANSIT', lineTitle: '地铁1号线', transportMode: 'METRO' }), stepFixture({ type: 'WALK' })] })) ===
      '步行 › 1号线 › 步行',
    '步行腿缺时长时只显示「步行」，不得猜测'
  );

  const longChain = optionFixture({
    durationMinutes: 28,
    estimatedCost: { amount: 2, currency: 'CNY' },
    steps: [
      stepFixture({ type: 'WALK', durationMinutes: 12 }),
      stepFixture({ type: 'TRANSIT', lineTitle: '一个非常非常非常长的公交线路名称', transportMode: 'BUS' }),
      stepFixture({ type: 'WALK', durationMinutes: 4 }),
      stepFixture({ type: 'TRANSIT', lineTitle: '地铁3号线北延段', transportMode: 'METRO' }),
      stepFixture({ type: 'WALK', durationMinutes: 8 }),
    ],
  });
  assert(
    buildCompactRouteSummary(longChain) ===
      '步行 12分钟 › 一个非常非常非常长的公交线路名称 › 步行 4分钟 › 3号线北延段 › 步行 8分钟',
    '长链视图模型保留全部真实腿，视图层再以 ellipsis 截断'
  );
  const longRow = buildRouteRowVMs([longChain])[0];
  assert(longRow.durationText === '28 分钟' && longRow.costText === '¥2', '长摘要不得影响时长和票价字段');
  const longGuangzhouSegments = buildRouteSummarySegments(longChain, { city: '广州市' });
  assert(
    longGuangzhouSegments[1].badge?.text === '一个非常非常非常长的公交线路名称' &&
      longGuangzhouSegments[3].badge?.text === '3',
    '长公交名保留 Provider 原文，后续地铁腿仍正确识别为 3 号线'
  );
  assert(
    longGuangzhouSegments.filter((segment) => segment.badge).length === 2,
    '混合链中公交与地铁 badge 都必须保留，不得丢腿'
  );

  // 无线路名 → 回退交通方式标签（地铁/公交/乘车），绝不把步骤 title 当线路名
  const noLineTitle = optionFixture({
    modes: ['WALK', 'METRO'],
    steps: [
      stepFixture({ type: 'WALK', title: '起步' }),
      stepFixture({
        type: 'TRANSIT',
        title: '体育西路',
        transportMode: 'METRO',
        durationMinutes: 8,
      }),
    ],
  });
  assert(buildRouteSummarySegments(noLineTitle)[1].label === '地铁', '无线路名时乘车段回退「地铁」');

  // 缺 transportMode 的乘车段：回退「乘车」+ generic 图标（绝不误标地铁/公交）
  const noModeTransit = optionFixture({
    modes: ['WALK'],
    steps: [
      stepFixture({ type: 'WALK', title: '起步' }),
      stepFixture({
        type: 'TRANSIT',
        title: '地铁 APM 线',
        subtitle: '珠江新城 → 广州塔',
        durationMinutes: 8,
      }),
    ],
  });
  const noModeSegs = buildRouteSummarySegments(noModeTransit);
  assert(
    noModeSegs[1].label === '乘车' && noModeSegs[1].mode === undefined,
    '缺 transportMode 时回退「乘车」'
  );
  assert(noModeSegs[1].iconUrl === '/assets/icons/route/generic.svg', '缺 transportMode 时用 generic 图标');

  // 空 steps 防御：链为空
  const emptyOption = optionFixture({ steps: [] });
  assert(buildRouteSummarySegments(emptyOption).length === 0, '无步骤时摘要段为空');

  // ---- Route Picker 行视图模型：三条同级 row ----
  const srcOptions = [optionFixture({ id: 'route_a' }), optionFixture({ id: 'route_b' }), optionFixture({ id: 'route_c' })];
  const rows: RouteRowView[] = buildRouteRowVMs(srcOptions);
  assert(rows.length === 3, '3 条方案生成 3 行（同级，非嵌套卡片）');
  assert(rows[0].labelText === '路线 1', '第 0 行标签「路线 1」');
  assert(rows[1].labelText === '路线 2', '第 1 行标签「路线 2」');
  assert(rows[2].labelText === '路线 3', '第 2 行标签「路线 3」');
  assert(rows[0].recommended === true, '第 0 行 recommended=true');
  assert(rows[1].recommended === false && rows[2].recommended === false, '其余行 recommended=false');
  assert(rows[0].durationText === '51 分钟', '行级总时长「51 分钟」');
  assert(rows[0].costText === '¥6', '行级总价格「¥6」');
  assert(rows[0].summarySegments.length === 2, '行级摘要段跳过 ARRIVAL');
  assert(rows[0].summarySegments[0].mode === 'WALK', '行级首段为步行');
  assert(rows[0].summarySegments[1].label === '3 号线', '行级乘车段为「3 号线」');
  assert(rows[0].summaryText === '步行 8分钟 › 3 号线', '行级提供单行有序摘要文本');
  assert(rows[1].raw === srcOptions[1], 'raw 必须引用原方案对象供导航事件回传');
  assert(rows.every((row) => row.summarySegments.length > 0), '每行都应有非空摘要段');
  assert(
    rows.every((row) => typeof row.durationText === 'string' && row.durationText.length > 0),
    '每行总时长均为非空字符串（行级唯一来源）'
  );

  // 结构回归：行级保留可测分段，并单独提供 WXML 直接渲染的 summaryText。
  assert('chain' in rows[0] === false, '行视图不得再含 icon 链字段');
  assert(typeof rows[0].summaryText === 'string', '行视图必须提供可省略的单行文本摘要');

  const guangzhouRows = buildRouteRowVMs(srcOptions, { city: '广州市' });
  assert(
    guangzhouRows[0].summarySegments[1].badge?.text === '3' &&
      guangzhouRows[0].summarySegments[1].badge?.backgroundColor === '#ECA154',
    '行视图应将广州 3 号线集成为紧凑线色 badge'
  );

  // 行视图防御：缺失时长/价格 → 空串（绝不泄漏 undefined/null/NaN）
  const defensiveRows = buildRouteRowVMs([
    optionFixture({
      id: 'route_defensive',
      durationMinutes: Number.NaN,
      estimatedCost: undefined,
      summary: '少换乘',
    }),
  ]);
  assert(defensiveRows[0].durationText === '', '非法时长行级显示空串');
  assert(defensiveRows[0].costText === '', '缺票价行级显示空串');
  assert(defensiveRows[0].featureText === '少换乘', 'featureText 透传 provider 真实标签');
  assert(buildRouteRowVMs([]).length === 0, '空方案列表生成空行列表');

  // 票价可见性：非推荐路线有票价时同样显示（price 不只在推荐行可见）
  const multiPricedRows = buildRouteRowVMs([
    optionFixture({ id: 'priced_a', estimatedCost: { amount: 2, currency: 'CNY' } }),
    optionFixture({ id: 'priced_b', estimatedCost: { amount: 2, currency: 'CNY' } }),
    optionFixture({ id: 'priced_c', estimatedCost: undefined }),
  ]);
  assert(multiPricedRows[0].costText === '¥2', '推荐行有票价显示 ¥2');
  assert(multiPricedRows[1].costText === '¥2', '第二条（非推荐）有票价同样显示 ¥2，不得只给推荐项显示');
  assert(multiPricedRows[2].costText === '', '纯步行/无票价路线行级隐藏价格');
  assert(
    multiPricedRows.every((row) => row.costText !== '¥--' && row.costText !== '未知'),
    '票价缺失时隐藏而非显示占位符'
  );

  // mock 预览数据票价可见性：方案1 ¥2 / 方案2 ¥2 / 方案3（纯步行）无
  const mockRows = buildRouteRowVMs(mockRouteOptions);
  assert(mockRows[0].costText === '¥2', 'mock 方案 1（步行+APM线）显示 ¥2');
  assert(mockRows[1].costText === '¥2', 'mock 方案 2（步行+1号线）显示 ¥2');
  assert(mockRows[2].costText === '', 'mock 方案 3（纯步行）不显示价格');

  // mock 折叠态分段链：方案1 = 步行8 › APM 线 › 步行6；方案3（纯步行）= 步行 39 分钟
  assert(mockRows[0].summarySegments.length === 3, 'mock 方案 1 三段链（跳过 ARRIVAL）');
  assert(mockRows[0].summarySegments[0].durationText === '8 分钟', 'mock 方案 1 首段步行 8 分钟');
  assert(mockRows[0].summarySegments[1].label === 'APM 线', 'mock 方案 1 地铁段为「APM 线」');
  assert(mockRows[0].summarySegments[2].durationText === '6 分钟', 'mock 方案 1 末段步行 6 分钟');
  assert(mockRows[1].summarySegments[1].label === '1 号线', 'mock 方案 2 地铁段为「1 号线」');
  assert(mockRows[2].summarySegments.length === 1, 'mock 方案 3 纯步行合并为 1 段');
  assert(mockRows[2].summarySegments[0].durationText === '39 分钟', 'mock 方案 3 步行总时长「39 分钟」');

  // ---- 展开详情视图模型：Travel Leg 列表 + 统一目的地脚注 ----
  const detail = buildRouteDetailVM(srcOption);
  assert(detail.id === srcOption.id, 'detail 保留方案 id');
  assert(detail.raw === srcOption, 'detail.raw 引用原方案对象');
  assert(detail.legs.length === 2, '腿列表跳过 ARRIVAL（目的地进脚注）');
  assert(detail.destinationText === '广州羽毛球中心羽毛球馆', '目的地名称来自 ARRIVAL 步骤');
  assert(detail.arrivalText === '11:27 到达', '脚注 ETA 为「11:27 到达」');

  const guangzhouDetail = buildRouteDetailVM(walkMetroWalk, undefined, { city: '广州市' });
  assert(
    guangzhouDetail.legs[1].transitBadge?.text === 'APM' &&
      guangzhouDetail.legs[1].transitBadge?.backgroundColor === '#00B5E2',
    '展开详情的 APM 腿应使用与折叠摘要相同的线色 badge'
  );
  assert(guangzhouDetail.legs[0].transitBadge === null, '展开详情的步行腿继续使用步行图标');

  // 结构回归：展开区不重复行级摘要——detail 上不存在行级专属字段
  assert('labelText' in detail === false, 'detail 不得含行级标签');
  assert('chain' in detail === false, 'detail 不得重复行级图标链');
  assert('summarySegments' in detail === false, 'detail 不得重复行级分段链');
  assert('costText' in detail === false, 'detail 不得重复行级总价格');
  assert('durationText' in detail === false, 'detail 不得重复行级总时长');
  assert(
    detail.legs.every((leg) => leg.durationText !== '51 分钟'),
    '腿时长是分腿时长，绝不等于行级总时长'
  );

  // detail 防御：无 ARRIVAL / 无到达时间
  const noArrival = buildRouteDetailVM(
    optionFixture({
      steps: [stepFixture({ type: 'WALK', title: '起步' })],
      arrivalTime: undefined,
    })
  );
  assert(noArrival.legs.length === 1, '无 ARRIVAL 时腿列表含步行段');
  assert(noArrival.destinationText === '', '无 ARRIVAL 时目的地为空串');
  assert(noArrival.arrivalText === '预计到达', '无到达时间时 ETA 退化为「预计到达」');
  assert(buildRouteDetailVM(emptyOption).legs.length === 0, '空方案腿列表为空');

  // ---- Travel Leg 视图模型：乘车段（统一三行结构：标题 / 上下车站 / 方向·站数） ----
  const metroLeg = buildRouteLeg(
    stepFixture({
      type: 'TRANSIT',
      title: '地铁3号线',
      lineTitle: '地铁3号线',
      transportMode: 'METRO',
      towardsStation: '广州东站',
      getonStation: '公园前',
      getoffStation: '广州东站',
      stationCount: 7,
      durationMinutes: 16,
      distanceMeters: 9000,
      estimatedCost: { amount: 6, currency: 'CNY' },
    }),
    1
  );
  assert(metroLeg.iconPath === '/assets/icons/route/metro.svg', 'METRO 乘车段用地铁图标');
  assert(metroLeg.titleText === '3号线', '乘车腿标题为归一化线路名「3号线」');
  assert(metroLeg.durationText === '16 分钟', '时长在腿头部右侧');
  assert(metroLeg.metricText === '公园前 → 广州东站', '第二行为「上车 → 下车」');
  assert(metroLeg.detailText === '往 广州东站 方向 · 乘 7 站', '第三行为「方向 · 站数」');
  assert(metroLeg.detailText.indexOf('公里') === -1, '地铁距离降级隐藏，不出现在第三行');
  assert(metroLeg.toneClass === 'accent', '乘车腿走 accent 档位');
  assert(
    metroLeg.transitBadge?.source === 'SEMANTIC',
    '无城市上下文时详情乘车腿只使用通用 badge，不猜测广州线色'
  );

  const guangzhouLine11Leg = buildRouteLeg(
    stepFixture({
      type: 'TRANSIT',
      title: '地铁11号线',
      lineTitle: '地铁11号线',
      transportMode: 'METRO',
    }),
    0,
    { city: '广州市' }
  );
  assert(
    guangzhouLine11Leg.transitBadge?.text === '11' &&
      guangzhouLine11Leg.transitBadge?.backgroundColor === '#F5BB17',
    '展开详情的两位数地铁线应显示「11」线色 badge'
  );
  // 结构回归：腿 VM 不再携带行级/旧字段（价格并入行级，方向/上下车/元信息并入三行结构）
  assert('priceText' in metroLeg === false, '腿 VM 不得含 priceText（行级统一展示总价）');
  assert('directionText' in metroLeg === false, '腿 VM 不得含 directionText');
  assert('boardingText' in metroLeg === false, '腿 VM 不得含 boardingText');
  assert('alightingText' in metroLeg === false, '腿 VM 不得含 alightingText');
  assert('metaText' in metroLeg === false, '腿 VM 不得含 metaText');
  assert('descText' in metroLeg === false, '腿 VM 不得含 descText');

  // 缺失字段防御：无方向/站数/上下车站/票价时对应行为空串（UI 隐藏），不出现 undefined/-- 泄漏
  const sparseBus = buildRouteLeg(
    stepFixture({
      type: 'TRANSIT',
      title: '观光巴士夜班线',
      transportMode: 'BUS',
      durationMinutes: 6,
    }),
    2
  );
  assert(sparseBus.iconPath === '/assets/icons/route/bus.svg', 'BUS 乘车腿用公交图标');
  assert(sparseBus.titleText === '观光巴士夜班线', '无 lineTitle 时标题回退步骤 title');
  assert(sparseBus.metricText === '', '无上下车站时第二行为空串');
  assert(sparseBus.detailText === '', '无方向/站数时第三行为空串');
  assert(sparseBus.durationText === '6 分钟', '仅时长时头部右侧显示时长');

  // 结构化上下车站全缺但存在紧凑 subtitle → metricText 回退 subtitle（防御旧/mock 数据）
  const subtitleFallback = buildRouteLeg(
    stepFixture({
      type: 'TRANSIT',
      title: '地铁 APM 线',
      subtitle: '珠江新城 → 广州塔',
      durationMinutes: 8,
    }),
    0
  );
  assert(subtitleFallback.titleText === 'APM 线', '无 lineTitle 时标题对 title 做前缀归一化');
  assert(subtitleFallback.metricText === '珠江新城 → 广州塔', '上下车站缺失时第二行回退紧凑副标题');
  assert(subtitleFallback.detailText === '', '无方向/站数时第三行为空串');
  assert(
    subtitleFallback.iconPath === '/assets/icons/route/generic.svg',
    '缺 transportMode 的乘车段必须回退 generic 图标，绝不误标为地铁/公交'
  );

  // ---- Travel Leg 视图模型：步行段（标题 / 距离 / 完整指引原文） ----
  const walkLeg = buildRouteLeg(
    stepFixture({
      type: 'WALK',
      title: '沿体育东路向南…',
      instruction: '沿体育东路向南步行至体育西路站入口',
      roadName: '体育东路',
      directionDesc: '向南',
      durationMinutes: 6,
      distanceMeters: 414,
    }),
    0
  );
  assert(walkLeg.iconPath === '/assets/icons/route/walk.svg', '步行腿用步行图标');
  assert(walkLeg.titleText === '步行', '步行腿标题统一为模式标签，避免与指引重复');
  assert(walkLeg.durationText === '6 分钟', '步行腿时长在头部右侧');
  assert(walkLeg.metricText === '414 米', '步行腿第二行为距离');
  assert(
    walkLeg.detailText === '沿体育东路向南步行至体育西路站入口',
    '步行腿第三行保留完整指引原文（不截断、不拼 road 前缀）'
  );
  assert(walkLeg.toneClass === 'walk', '步行腿走 neutral 档位');
  assert(walkLeg.transitBadge === null, '步行腿不得生成交通线路 badge');

  const noInstructionWalk = buildRouteLeg(
    stepFixture({ type: 'WALK', title: '步行', subtitle: '约 300 米', durationMinutes: 5 }),
    1
  );
  assert(noInstructionWalk.metricText === '', '无距离时步行腿第二行为空串');
  assert(noInstructionWalk.detailText === '约 300 米', '无指引原文时回退 subtitle，不编造文案');

  // ---- 整条方案腿列表：跳过 ARRIVAL、key 唯一 ----
  const legs = buildRouteLegs(srcOption);
  assert(legs.length === srcOption.steps.length - 1, '腿列表 = steps 数减 ARRIVAL');
  assert(new Set(legs.map((leg) => leg.key)).size === legs.length, '腿 key 必须唯一');

  console.log('✅ route-options-ui.test.ts 全部通过');
}
