// mock/mock-route-options.ts
// ⚠️ DEV FIXTURE：仅供 mock 模式预览，非真实数据。
// 所有时长、票价、线路、坐标均为手工编写的演示值（广州大致区域），
// 绝不可用于真实业务判断；real 模式一律走 TencentDirectionProvider 真实请求。

import { RouteOption, ResolvedDestination } from '../types/route-option';

/** 演示目的地：广州塔（坐标为真实大致值） */
export const MOCK_ROUTE_DESTINATION: ResolvedDestination = {
  name: '广州塔',
  latitude: 23.106644,
  longitude: 113.324658,
};

export const mockRouteOptions: RouteOption[] = [
  // 方案一：地铁 + 步行，51 分钟，地铁票价 ¥6（演示值），推荐
  {
    id: 'mock_route_metro_fast',
    recommended: true,
    durationMinutes: 51,
    distanceMeters: 14200,
    estimatedCost: { amount: 6, currency: 'CNY' },
    modes: ['WALK', 'METRO'],
    steps: [
      {
        type: 'WALK',
        title: '当前位置',
        subtitle: '步行至体育西路站',
        durationMinutes: 10,
        distanceMeters: 700,
        latitude: 23.121208,
        longitude: 113.318702,
      },
      {
        type: 'TRANSIT',
        title: '地铁 3 号线',
        subtitle: '体育西路 → 广州塔',
        durationMinutes: 36,
        distanceMeters: 12800,
        latitude: 23.12916,
        longitude: 113.32062,
      },
      {
        type: 'WALK',
        title: '步行至广州塔',
        subtitle: '约 300 米',
        durationMinutes: 5,
        distanceMeters: 300,
        latitude: 23.106644,
        longitude: 113.324658,
      },
      { type: 'ARRIVAL', title: '广州塔' },
    ],
  },
  // 方案二：公交 + 步行，58 分钟，无票价信息（estimatedCost 缺省），标签「少走路」
  {
    id: 'mock_route_bus_walk',
    recommended: false,
    durationMinutes: 58,
    distanceMeters: 11800,
    summary: '少走路',
    modes: ['WALK', 'BUS'],
    steps: [
      {
        type: 'WALK',
        title: '当前位置',
        subtitle: '步行至五羊新村站',
        durationMinutes: 4,
        distanceMeters: 280,
        latitude: 23.121208,
        longitude: 113.318702,
      },
      {
        type: 'TRANSIT',
        title: '262 路',
        subtitle: '五羊新村 → 广州塔西',
        durationMinutes: 46,
        distanceMeters: 11000,
        latitude: 23.114532,
        longitude: 113.314621,
      },
      {
        type: 'WALK',
        title: '步行至广州塔',
        subtitle: '约 500 米',
        durationMinutes: 8,
        distanceMeters: 500,
        latitude: 23.105900,
        longitude: 113.330097,
      },
      { type: 'ARRIVAL', title: '广州塔' },
    ],
  },
  // 方案三：地铁直达少换乘，63 分钟，标签「少换乘」
  {
    id: 'mock_route_metro_few_transfer',
    recommended: false,
    durationMinutes: 63,
    distanceMeters: 15600,
    summary: '少换乘',
    modes: ['WALK', 'METRO'],
    steps: [
      {
        type: 'WALK',
        title: '当前位置',
        subtitle: '步行至珠江新城站',
        durationMinutes: 15,
        distanceMeters: 1100,
        latitude: 23.121208,
        longitude: 113.318702,
      },
      {
        type: 'TRANSIT',
        title: '地铁 APM 线',
        subtitle: '珠江新城 → 广州塔',
        durationMinutes: 40,
        distanceMeters: 14000,
        latitude: 23.1181,
        longitude: 113.3220,
      },
      {
        type: 'WALK',
        title: '步行至广州塔',
        subtitle: '约 400 米',
        durationMinutes: 8,
        distanceMeters: 400,
        latitude: 23.106644,
        longitude: 113.324658,
      },
      { type: 'ARRIVAL', title: '广州塔' },
    ],
  },
];
