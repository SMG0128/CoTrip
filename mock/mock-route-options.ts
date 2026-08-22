// mock/mock-route-options.ts
// ⚠️ DEV FIXTURE：仅供 mock 模式预览，非真实数据。
// 字段结构与 TencentDirectionAdapter 的真实映射严格同构（types/route-option.ts 的
// Provider 信息保留字段：lineTitle/transportMode/towardsStation/getonStation/
// getoffStation/stationCount/instruction/roadName…）；数值为手工编写的演示近似值
// （广州真实锚点坐标 + 合理时长）。绝不可用于真实业务判断；
// real 模式一律走 TencentDirectionProvider 真实请求，绝不回退到本文件。
//
// 目的地与 demo 行程（mockActiveTrip）计划中的首个带地点事件保持一致：
// 广州羽毛球中心羽毛球馆 —— 页面 resolveRouteDestinationName() 的推导结果，
// 保证「我的推荐」预览与真实模式查询语义一致（仅此一个行程是 Mock 的）。

import { RouteOption, ResolvedDestination } from '../types/route-option';

/** 演示目的地：demo 计划中的羽毛球馆（坐标为真实大致值） */
export const MOCK_ROUTE_DESTINATION: ResolvedDestination = {
  name: '广州羽毛球中心羽毛球馆',
  latitude: 23.1319,
  longitude: 113.3213,
};

export const mockRouteOptions: RouteOption[] = [
  // 方案一（推荐）：步行 + APM 线，约 21 分钟。
  // 展示完整结构化乘车段：线路名 / 方向终点站 / 上下车站 / 站数 / 分段票价。
  {
    id: 'mock_route_apm',
    recommended: true,
    durationMinutes: 21,
    distanceMeters: 2400,
    estimatedCost: { amount: 2, currency: 'CNY' },
    modes: ['WALK', 'METRO'],
    steps: [
      {
        type: 'WALK',
        title: '当前位置',
        subtitle: '约 550 米',
        instruction: '沿林和中路向南步行至林和西站入口',
        roadName: '林和中路',
        directionDesc: '向南',
        durationMinutes: 8,
        distanceMeters: 550,
        latitude: 23.1408,
        longitude: 113.3253,
      },
      {
        type: 'TRANSIT',
        title: '地铁 APM 线',
        lineTitle: '地铁 APM 线',
        subtitle: '林和西 → 天河体育中心',
        transportMode: 'METRO',
        towardsStation: '广州塔',
        getonStation: '林和西',
        getoffStation: '天河体育中心',
        stationCount: 1,
        durationMinutes: 4,
        distanceMeters: 1100,
        latitude: 23.1399,
        longitude: 113.3244,
      },
      {
        type: 'WALK',
        title: '步行至场馆',
        subtitle: '约 380 米',
        instruction: '沿天河路向东步行至体育中心羽毛球附馆',
        durationMinutes: 6,
        distanceMeters: 380,
        latitude: 23.1352,
        longitude: 113.3221,
      },
      { type: 'ARRIVAL', title: '广州羽毛球中心羽毛球馆' },
    ],
  },
  // 方案二：步行 + 地铁 1 号线，约 28 分钟。
  // 刻意缺少 towardsStation / road 字段 → 预览防御性隐藏路径；
  // 票价保留（1 号线 2 站 ¥2 演示值，与 provider 线路级票价汇总兜底语义一致）。
  {
    id: 'mock_route_line1',
    recommended: false,
    durationMinutes: 28,
    distanceMeters: 3100,
    estimatedCost: { amount: 2, currency: 'CNY' },
    modes: ['WALK', 'METRO'],
    steps: [
      {
        type: 'WALK',
        title: '当前位置',
        subtitle: '约 700 米',
        instruction: '沿林和中路向南步行至广州东站地铁站',
        durationMinutes: 10,
        distanceMeters: 700,
        latitude: 23.1408,
        longitude: 113.3253,
      },
      {
        type: 'TRANSIT',
        title: '地铁 1 号线',
        lineTitle: '地铁 1 号线',
        subtitle: '广州东站 → 体育中心',
        transportMode: 'METRO',
        getonStation: '广州东站',
        getoffStation: '体育中心',
        stationCount: 2,
        durationMinutes: 6,
        distanceMeters: 1600,
        latitude: 23.1442,
        longitude: 113.3241,
      },
      {
        type: 'WALK',
        title: '步行至场馆',
        subtitle: '约 480 米',
        instruction: '沿体育东路向北步行至天河路229号附馆',
        durationMinutes: 7,
        distanceMeters: 480,
        latitude: 23.1361,
        longitude: 113.3216,
      },
      { type: 'ARRIVAL', title: '广州羽毛球中心羽毛球馆' },
    ],
  },
  // 方案三：纯步行，约 39 分钟，无票价信息（estimatedCost 缺省）。
  // 单一模式路线：多个指引节点 + 完整 instruction，展示步行时间轴形态。
  {
    id: 'mock_route_walk_only',
    recommended: false,
    durationMinutes: 39,
    distanceMeters: 3200,
    modes: ['WALK'],
    steps: [
      {
        type: 'WALK',
        title: '当前位置',
        instruction: '沿林和中路向南步行至天河北路口',
        roadName: '林和中路',
        directionDesc: '向南',
        durationMinutes: 12,
        distanceMeters: 950,
        latitude: 23.1408,
        longitude: 113.3253,
      },
      {
        type: 'WALK',
        title: '步行',
        instruction: '沿体育东路向南步行至天河路口',
        roadName: '体育东路',
        directionDesc: '向南',
        durationMinutes: 18,
        distanceMeters: 1500,
        latitude: 23.1372,
        longitude: 113.3224,
      },
      {
        type: 'WALK',
        title: '步行至场馆',
        subtitle: '约 750 米',
        instruction: '沿天河路向东步行到达体育中心羽毛球附馆',
        durationMinutes: 9,
        distanceMeters: 750,
        latitude: 23.1319,
        longitude: 113.3213,
      },
      { type: 'ARRIVAL', title: '广州羽毛球中心羽毛球馆' },
    ],
  },
];
