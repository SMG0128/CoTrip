// tests/route-option.test.ts
// 「我的推荐」数据层测试：top-N 选择规则、腾讯 direction DTO 防御式映射、
// Real 服务失败语义与 Mock 行为（纯 Node，无 wx 网络依赖）。

import { isTencentMapConfigured } from '../config/tencent-map';
import {
  RouteOptionError,
  TencentDirectionAdapter,
  selectTopRouteOptions,
} from '../services/providers/tencent-direction-provider';
import {
  MockRouteOptionService,
  RealRouteOptionService,
} from '../services/route-option-service';
import { RouteOption } from '../types/route-option';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`断言失败: ${message}`);
}

/** 断言 Promise 以 RouteOptionError 拒绝且满足谓词（绝不 resolve 假数据） */
async function expectReject(
  operation: () => Promise<unknown>,
  predicate: (error: RouteOptionError) => boolean,
  message: string
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    assert(error instanceof RouteOptionError && predicate(error), message);
    return;
  }
  throw new Error(`断言失败: ${message}`);
}

function routeFixture(id: string, overrides: Partial<RouteOption> = {}): RouteOption {
  return {
    id,
    recommended: false,
    durationMinutes: 30,
    modes: ['WALK'],
    steps: [{ type: 'WALK', title: '当前位置' }],
    ...overrides,
  };
}

/** 手工构造 transit 响应 DTO（官方现行结构）：steps[] 按 mode 分派，乘车段在 lines[] */
function transitResponseFixture(): unknown {
  return {
    status: 0,
    message: 'query ok',
    result: {
      routes: [
        {
          duration: 51,
          distance: 14200,
          // price_unit=1 时单位为「分」：600 分 = ¥6
          price: 600,
          strategy: 32, // 数字策略编码：含义不明，不得透传为 summary
          steps: [
            {
              mode: 'WALKING',
              duration: 10,
              distance: 700,
              steps: [
                {
                  instruction: '沿体育东路向南步行至体育西路站入口',
                  road_name: '体育东路',
                  dir_desc: '向南',
                  act_desc: '直行',
                },
              ],
              // 压缩折线一维数组：首点为原值 [lat0, lng0, ...]
              polyline: [23.1212, 113.3187, -120, 30],
            },
            {
              mode: 'TRANSIT',
              lines: [
                {
                  id: 'gz_line_3',
                  title: '地铁3号线',
                  vehicle: 'SUBWAY',
                  station_count: 7,
                  run_status: 1,
                  duration: 30,
                  distance: 11000,
                  // 分段票价：price_unit=1 时单位为分；300 分 = ¥3
                  price: 300,
                  geton: { title: '体育西路', location: { lat: 23.12916, lng: 113.32062 } },
                  getoff: { title: '广州塔', location: { lat: 23.106644, lng: 113.324658 } },
                  destination: { title: '广州东站' },
                },
              ],
            },
            { mode: 'WALKING', duration: 5, distance: 300, steps: [], polyline: [] },
            {
              mode: 'TRANSIT',
              lines: [
                {
                  title: '观光巴士夜班线',
                  vehicle: 'BUS',
                  duration: 6,
                  distance: 2000,
                  price: -1,
                  geton: { title: '广州塔西', location: { lat: 23.1059, lng: 113.330097 } },
                },
              ],
            },
          ],
        },
        {
          // 无票价的第二条路线：estimatedCost 必须为 undefined
          duration: 58,
          distance: 15000,
          steps: [
            {
              mode: 'TRANSIT',
              lines: [
                {
                  id: 105, // 数字形态的线路 id：应字符串化为 '105'
                  title: '地铁5号线',
                  vehicle: 'SUBWAY',
                  run_status: '1', // 字符串形态的运行状态：原样保留
                  duration: 40,
                  distance: 13000,
                  geton: { title: '珠江新城', location: { lat: 23.119, lng: 113.322 } },
                  getoff: { title: '广州塔', location: { lat: 23.106644, lng: 113.324658 } },
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

/** transit 响应：route 级无 price，但线路级有正票价 → 汇总到 route 级（不丢票价） */
function transitLinePriceOnlyFixture(): unknown {
  return {
    status: 0,
    result: {
      routes: [
        {
          duration: 44,
          distance: 13000,
          // 无 route 级 price：腾讯可能仅在线路级给出票价
          steps: [
            {
              mode: 'TRANSIT',
              lines: [
                {
                  title: '地铁3号线',
                  vehicle: 'SUBWAY',
                  duration: 18,
                  distance: 8000,
                  price: 200, // 200 分 = ¥2
                  geton: { title: '体育西路', location: { lat: 23.12916, lng: 113.32062 } },
                  getoff: { title: '广州塔', location: { lat: 23.106644, lng: 113.324658 } },
                },
                {
                  title: '地铁APM线',
                  vehicle: 'SUBWAY',
                  duration: 6,
                  distance: 2000,
                  price: 300, // 300 分 = ¥3
                  geton: { title: '广州塔', location: { lat: 23.106644, lng: 113.324658 } },
                  getoff: { title: '广州东站', location: { lat: 23.1519, lng: 113.3225 } },
                },
                {
                  title: '观光巴士夜班线',
                  vehicle: 'BUS',
                  duration: 6,
                  distance: 2000,
                  price: -1, // -1 = 无票价：不得参与汇总
                  geton: { title: '广州塔西', location: { lat: 23.1059, lng: 113.330097 } },
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

/** 手工构造 walking 响应 DTO：两个指引分段（polyline 首点为原值） */
function walkingResponseFixture(): unknown {
  return {
    status: 0,
    message: 'query ok',
    result: {
      routes: [
        {
          mode: 'WALKING',
          duration: 45,
          distance: 3800,
          steps: [
            {
              instruction: '沿体育东路向东步行',
              polyline: [23.1212, 113.3187, 80, 130],
              distance: 1900,
              duration: 24,
            },
            {
              instruction: '沿阅江西路向西步行',
              road_name: '阅江西路',
              dir_desc: '向西',
              act_desc: '直行',
              polyline: [],
              distance: 1900,
              duration: 21,
            },
          ],
        },
      ],
    },
  };
}

export async function runRouteOptionTests(): Promise<void> {
  // ---- selectTopRouteOptions：数量上限 ----
  const fiveOptions = [
    routeFixture('a_30_walk', { durationMinutes: 30, modes: ['WALK'] }),
    routeFixture('b_31_walk', { durationMinutes: 31, modes: ['WALK'] }), // 与 a 近似重复
    routeFixture('c_40_metro', { durationMinutes: 40, modes: ['WALK', 'METRO'] }),
    routeFixture('d_41_metro', { durationMinutes: 41, modes: ['WALK', 'METRO'] }), // 与 c 近似重复
    routeFixture('e_55_bus', { durationMinutes: 55, modes: ['BUS'] }),
  ];
  const top3 = selectTopRouteOptions(fiveOptions);
  assert(top3.length === 3, '5 条输入最多输出 3 条');
  assert(
    top3.map((o) => o.id).join(',') === 'a_30_walk,c_40_metro,e_55_bus',
    '近似重复（<3min 且同 modes）必须被剔除，保持原顺序'
  );

  // ---- selectTopRouteOptions：recommended 归一化 ----
  const markedInput = [...fiveOptions];
  markedInput[2] = { ...markedInput[2], recommended: true }; // 输入里的标记应被重置
  const normalized = selectTopRouteOptions(markedInput);
  assert(normalized[0].recommended === true, '排序后第一条必须 recommended=true');
  assert(
    normalized.slice(1).every((o) => o.recommended === false),
    '除第一条外其余必须 recommended=false'
  );

  // ---- selectTopRouteOptions：边界 ----
  assert(selectTopRouteOptions([]).length === 0, '空输入必须安全返回空数组');
  const two = selectTopRouteOptions(fiveOptions.slice(0, 2));
  assert(two.length === 1, '两条同 modes 且时长差 <3min 只保留第一条（不足不补）');
  const distinctTwo = selectTopRouteOptions([
    routeFixture('w30', { durationMinutes: 30, modes: ['WALK'] }),
    routeFixture('m40', { durationMinutes: 40, modes: ['METRO'] }),
  ]);
  assert(distinctTwo.length === 2, '不足 3 条时原样保留全部非重复项');

  // 恰好相差 3 分钟不算近似重复（阈值是严格小于）
  const boundary = selectTopRouteOptions([
    routeFixture('p30', { durationMinutes: 30, modes: ['WALK'] }),
    routeFixture('q33', { durationMinutes: 33, modes: ['WALK'] }),
  ]);
  assert(boundary.length === 2, '时长差恰为 3 分钟不应被剔除');

  // 自定义 max 生效
  assert(selectTopRouteOptions(fiveOptions, 2).length === 2, 'max 参数应生效');

  // ---- Adapter：transit DTO → RouteOption ----
  const adapter = new TencentDirectionAdapter();
  const transitOptions = adapter.toRouteOptions(transitResponseFixture(), 'transit', {
    destinationName: '广州塔',
  });
  assert(transitOptions.length === 2, '两条有效 transit route 应映射出两条方案');

  const transit = transitOptions[0];
  assert(
    JSON.stringify(transit.modes) === JSON.stringify(['WALK', 'METRO', 'BUS']),
    'modes 应按出现顺序提取：步行→地铁(含「号线」)→公交'
  );
  assert(transit.durationMinutes === 51 && transit.distanceMeters === 14200, '总时长/距离应透传');
  assert(transit.steps.length === 5, '时间轴应为 4 个交通节点 + 到达节点');
  assert(
    transit.steps[transit.steps.length - 1].type === 'ARRIVAL' &&
      transit.steps[transit.steps.length - 1].title === '广州塔',
    '最后一步必须是 ARRIVAL 且标题为目的地名称'
  );
  assert(transit.steps[0].type === 'WALK', '首步应为步行段');
  assert(
    transit.steps[1].type === 'TRANSIT' &&
      transit.steps[1].title === '地铁3号线' &&
      transit.steps[1].subtitle === '体育西路 → 广州塔',
    '乘车段标题取线路名、副标题为上下车站'
  );
  assert(
    transit.steps[1].latitude === 23.12916 && transit.steps[1].longitude === 113.32062,
    '乘车段应带上车站（geton）坐标'
  );
  assert(
    transit.steps[0].latitude === 23.1212 && transit.steps[0].longitude === 113.3187,
    '步行段应取压缩折线首点（首点为原值）作为节点坐标'
  );
  assert(
    transit.steps[3].type === 'TRANSIT' &&
      transit.steps[3].title === '观光巴士夜班线' &&
      transit.steps[3].subtitle === undefined,
    '缺少下车站名时 subtitle 应为 undefined 而非编造'
  );
  assert(
    transit.estimatedCost !== undefined &&
      transit.estimatedCost.amount === 6 &&
      transit.estimatedCost.currency === 'CNY',
    'route.price=600 分（price_unit=1）必须换算为 ¥6，绝不猜测单位'
  );
  const noPriceOption = transitOptions[1];
  assert(
    noPriceOption.estimatedCost === undefined && noPriceOption.durationMinutes === 58,
    '无 route.price 的路线 estimatedCost 必须为 undefined 且正常映射其余字段'
  );
  // 线路级票价汇总兜底：route 级 price 缺失时不得丢票价（「有地铁却无票价显示」的根因回归）
  const linePriceOptions = adapter.toRouteOptions(transitLinePriceOnlyFixture(), 'transit', {
    destinationName: '广州塔',
  });
  assert(linePriceOptions.length === 1, '仅线路级票价的路线应正常映射');
  assert(
    linePriceOptions[0].estimatedCost !== undefined &&
      linePriceOptions[0].estimatedCost.amount === 5 &&
      linePriceOptions[0].estimatedCost.currency === 'CNY',
    'route 级 price 缺失时由线路级票价（200+300=500 分，-1 不计）汇总为 ¥5，不得丢票价'
  );
  // 纯步行路线恒无票价：不得出现「步行 ¥N」
  const walkWithoutPrice = adapter.toRouteOptions(walkingResponseFixture(), 'walking', {
    destinationName: '广州塔',
  });
  assert(
    walkWithoutPrice.length === 1 && walkWithoutPrice[0].estimatedCost === undefined,
    '纯步行路线不得携带票价（estimatedCost 恒为 undefined）'
  );
  assert(transit.summary === undefined, '数字策略编码不得翻译为 summary 文案');
  assert(
    transit.departureTime === undefined && transit.arrivalTime === undefined,
    '未提供出发时刻时不得推算出发/到达时间'
  );
  assert(transit.recommended === false, 'adapter 不做推荐标记，交给 selectTopRouteOptions 归一化');

  // ---- Adapter：Provider 字段信息保留（有值才保留，缺失即 undefined）----
  const metroLineStep = transit.steps[1];
  assert(
    metroLineStep.lineTitle === '地铁3号线' && metroLineStep.transportMode === 'METRO',
    '乘车段应保留线路名与子模式（vehicle=SUBWAY → METRO）'
  );
  assert(
    metroLineStep.getonStation === '体育西路' && metroLineStep.getoffStation === '广州塔',
    '上下车站名应结构化保留'
  );
  assert(metroLineStep.stationCount === 7, 'station_count 应结构化保留');
  assert(
    metroLineStep.towardsStation === '广州东站',
    'destination.title 应解析为运行方向终点站'
  );
  assert(metroLineStep.lineId === 'gz_line_3', '线路 id 应字符串化保留');
  assert(
    metroLineStep.runStatus === '1',
    'run_status 数字原始值应原样字符串化保留（不做语义解读）'
  );
  assert(
    metroLineStep.estimatedCost !== undefined &&
      metroLineStep.estimatedCost.amount === 3 &&
      metroLineStep.estimatedCost.currency === 'CNY',
    '分段票价 300 分（price_unit=1）应换算为 ¥3'
  );

  // 步行段：完整指引原文 + 道路/方向/动作描述保留
  const walkSegment = transit.steps[0];
  assert(
    walkSegment.instruction === '沿体育东路向南步行至体育西路站入口',
    '步行指引完整原文必须保留（标题截断不等于丢弃原文）'
  );
  assert(
    walkSegment.roadName === '体育东路' &&
      walkSegment.directionDesc === '向南' &&
      walkSegment.actionDesc === '直行',
    'road_name/dir_desc/act_desc 应结构化保留'
  );

  // 缺失字段防御：无 station_count/destination/run_status/正票价的线路一律 undefined
  const busLineStep = transit.steps[3];
  assert(busLineStep.transportMode === 'BUS', '非地铁线路按 BUS 分类');
  assert(
    busLineStep.stationCount === undefined &&
      busLineStep.towardsStation === undefined &&
      busLineStep.runStatus === undefined &&
      busLineStep.lineId === undefined &&
      busLineStep.estimatedCost === undefined,
    'provider 未返回的字段必须保持 undefined，绝不伪造'
  );

  // 第二条路线：数字 id 与字符串 run_status 的读取路径
  const line5Step = noPriceOption.steps[0];
  assert(line5Step.lineId === '105', '数字形态线路 id 应字符串化为 id');
  assert(line5Step.runStatus === '1', '字符串形态 run_status 原样保留');
  assert(
    line5Step.towardsStation === undefined && line5Step.stationCount === undefined,
    '未返回的方向/站数保持 undefined'
  );

  // ---- Adapter：出发时刻推算 ----
  const timedOptions = adapter.toRouteOptions(walkingResponseFixture(), 'walking', {
    destinationName: '广州塔',
    departureTimeIso: '2026-08-22T02:00:00.000Z',
  });
  assert(
    timedOptions[0].departureTime === '2026-08-22T02:00:00.000Z' &&
      timedOptions[0].arrivalTime === '2026-08-22T02:45:00.000Z',
    '提供出发时刻时应按 duration 推算到达时刻（ISO-8601）'
  );

  // ---- Adapter：walking DTO → 单一 WALK 模式 ----
  const walkOnly = adapter.toRouteOptions(walkingResponseFixture(), 'walking', {
    destinationName: '广州塔',
  });
  assert(
    walkOnly.length === 1 &&
      JSON.stringify(walkOnly[0].modes) === JSON.stringify(['WALK']) &&
      walkOnly[0].steps.length === 3,
    '纯步行路线应只有 WALK 模式且时间轴为 2 个步行节点 + 到达'
  );
  assert(
    walkOnly[0].steps[0].latitude === 23.1212 && walkOnly[0].steps[0].longitude === 113.3187,
    '步行节点应从 path 折线首点解析坐标'
  );
  assert(
    walkOnly[0].steps[0].instruction === '沿体育东路向东步行' &&
      walkOnly[0].steps[0].roadName === undefined,
    '纯步行节点保留完整指引原文；未返回的道路描述保持 undefined'
  );
  assert(
    walkOnly[0].steps[1].directionDesc === '向西' && walkOnly[0].steps[1].roadName === '阅江西路',
    '第二个步行节点的道路/方向描述应结构化保留'
  );
  assert(
    walkOnly[0].steps[walkOnly[0].steps.length - 1].title === '广州塔' &&
      walkOnly[0].steps[walkOnly[0].steps.length - 1].type === 'ARRIVAL',
    '步行路线同样以 ARRIVAL 结尾'
  );

  // ---- Adapter：防御式解析（字段缺失/形状异常不抛错、不造假） ----
  assert(adapter.toRouteOptions({}, 'transit').length === 0, '缺 result 时应返回空数组');
  assert(adapter.toRouteOptions(null, 'walking').length === 0, 'null 响应应安全返回空数组');
  const invalidRoutes = adapter.toRouteOptions(
    {
      status: 0,
      result: { routes: [null, {}, { duration: '不是数字' }, { duration: 0 }, { duration: -5 }] },
    },
    'transit',
    { destinationName: '某地' }
  );
  assert(invalidRoutes.length === 0, 'duration 缺失/非法/非正数的路线必须整条丢弃');
  const noTimeline = adapter.toRouteOptions(
    { status: 0, result: { routes: [{ duration: 30 }] } },
    'transit',
    { destinationName: '某地' }
  );
  assert(noTimeline.length === 0, 'transit 无可构造时间轴（无 steps 内容）时不展示');

  // ---- Real 服务失败语义：未配置 Key 必须真实抛错，绝不 resolve 假路线 ----
  // 前提说明：仓库内 Key 为占位符时才可触发 NOT_CONFIGURED；开发者本地填入真实 Key
  // （config/tencent-map.ts，git-ignored 语义上的本地改动）后此路径不可达且 Node 无 wx.request，
  // 因此仅在「Key 未配置」环境下执行该断言，占位符 CI 环境始终覆盖。
  if (!isTencentMapConfigured()) {
    const realService = new RealRouteOptionService();
    await expectReject(
      () =>
        realService.planRoutes({
          destinationName: '广州塔',
          origin: { latitude: 23.1212, longitude: 113.3187 },
        }),
      (error) => error.code === 'NOT_CONFIGURED',
      '未配置 Key 时 planRoutes 必须 reject NOT_CONFIGURED，绝不 resolve 出假路线'
    );
  } else {
    console.log(
      'ℹ️ 检测到本地已配置真实腾讯 Key：跳过 NOT_CONFIGURED 断言（该语义由占位符环境覆盖）'
    );
  }

  // ---- Mock 服务：resolve 出 1..3 条且第一条 recommended ----
  const mockService = new MockRouteOptionService();
  const mockResult = await mockService.planRoutes({ destinationName: '任意地点' });
  assert(
    mockResult.options.length >= 1 && mockResult.options.length <= 3,
    'Mock 必须返回 1..3 条演示方案'
  );
  assert(mockResult.options[0].recommended === true, 'Mock 第一条必须 recommended=true');
  assert(mockResult.resolvedDestination !== undefined, 'Mock 应携带演示目的地坐标');

  console.log('✅ route-option.test.ts 全部通过');
}
