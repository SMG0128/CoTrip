// tests/personal-route.test.ts
// 「我的推荐」门禁纯函数测试：
// - resolveDefaultDeparturePlace：首位优先、跳过无效坐标、空列表
// - resolveFirstPlanLocation：按事件顺序取第一个有名字的地点
// - resolvePersonalRouteGate：只要求首地点已就绪；出发地点为「使用保存地点」候选（可为空）

import {
  NO_FIRST_LOCATION_TEXT,
  resolveDefaultDeparturePlace,
  resolveFirstPlanLocation,
  resolvePersonalRouteGate,
} from '../utils/personal-route';
import { Location } from '../types/location';
import { Plan } from '../types/plan';
import { PlanEvent } from '../types/event';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

function place(id: string, name: string, lat?: number, lng?: number): Location {
  return { id, name, latitude: lat, longitude: lng, address: '' };
}

function event(id: string, location?: Location): PlanEvent {
  return {
    id,
    type: 'OTHER',
    title: `事件 ${id}`,
    time: { start: '2026-08-22T10:00:00+08:00', end: '2026-08-22T12:00:00+08:00', timezone: 'Asia/Shanghai' },
    ...(location ? { location } : {}),
  };
}

function plan(events: PlanEvent[]): Plan {
  return {
    id: 'plan_t',
    tripId: 'trip_t',
    version: 1,
    events,
    satisfiedConstraintCount: 0,
    totalConstraintCount: 0,
    conflicts: [],
    updatedAt: '2026-08-22T09:00:00+08:00',
  };
}

const HOME = place('p_home', '家', 23.1, 113.2);
const GYM = place('loc_gym', '广州羽毛球中心羽毛球馆', 23.13, 113.32);

// ---- 1. 默认出发点：首位优先，跳过无坐标条目 ----
{
  assert(resolveDefaultDeparturePlace([]) === null, '空列表应无默认出发点');

  const first = resolveDefaultDeparturePlace([HOME, place('p_b', '公司', 23.2, 113.3)]);
  assert(first !== null && first.place.id === 'p_home', '首位即默认出发点');
  assert(first !== null && first.latitude === 23.1 && first.longitude === 113.2, '坐标应原样收窄返回');

  // 坐标损坏的条目无法作为路线起点：顺序向后取第一条合法记录，绝不伪造坐标
  const skipped = resolveDefaultDeparturePlace([place('p_bad', '缺坐标'), HOME]);
  assert(skipped !== null && skipped.place.id === 'p_home', '无坐标条目应被跳过');
  assert(
    resolveDefaultDeparturePlace([place('p_nan', '坏点', NaN, 113.2)]) === null,
    'NaN 坐标应视为不可用',
  );
}

// ---- 2. 计划第一个地点 ----
{
  assert(resolveFirstPlanLocation(undefined) === null, '无计划应无第一个地点');
  assert(resolveFirstPlanLocation(plan([])) === null, '空事件计划应无第一个地点');
  assert(resolveFirstPlanLocation(plan([event('e1')])) === null, '事件无地点应视为无第一个地点');

  const found = resolveFirstPlanLocation(plan([event('e1'), event('e2', GYM), event('e3', HOME)]));
  assert(found !== null && found.id === 'loc_gym', '应取第一个带地点的事件');

  assert(
    resolveFirstPlanLocation(plan([event('e1', place('loc_blank', '   ', 23.1, 113.2))])) === null,
    '空白地点名应视为没有地点',
  );
}

// ---- 3. 门禁：只拦截「缺第一个地点」；出发地点不再是硬前提 ----
{
  // 两者皆缺：唯一拦截原因固定为缺第一个地点
  const bothMissing = resolvePersonalRouteGate({ departurePlaces: [], plan: undefined });
  assert(!bothMissing.ok && bothMissing.reason === 'NO_FIRST_LOCATION', '两者皆缺时应拦截为缺第一个地点');
  assert(!bothMissing.ok && bothMissing.message === NO_FIRST_LOCATION_TEXT, '文案应为「行程未生成」');

  // 有出发地点但无第一个地点：仍拦截（出发地点不能替代目的地）
  const noDestination = resolvePersonalRouteGate({ departurePlaces: [HOME], plan: plan([event('e1')]) });
  assert(!noDestination.ok && noDestination.reason === 'NO_FIRST_LOCATION', '缺第一个地点应被拦截');
  assert(!noDestination.ok && noDestination.message === NO_FIRST_LOCATION_TEXT, '文案应为「行程未生成」');
  assert(NO_FIRST_LOCATION_TEXT === '行程未生成', '缺第一个地点文案常量应与产品规则一致');
}

// ---- 4. 门禁通过：首地点即放行；origin 为「使用保存地点」候选（可为空，不自动调用） ----
{
  // 无已保存出发地点：放行但 origin 为空（面板显示「地图选点」入口，不自动调用）
  const noOrigin = resolvePersonalRouteGate({ departurePlaces: [], plan: plan([event('e1'), event('e2', GYM)]) });
  assert(noOrigin.ok, '有第一个地点时应放行（出发地点不再是硬前提）');
  assert(noOrigin.ok && noOrigin.origin === null, '无已保存出发地点时 origin 应为空');

  // 有已保存出发地点：origin 提供「使用保存地点」候选
  const gate = resolvePersonalRouteGate({ departurePlaces: [HOME], plan: plan([event('e1'), event('e2', GYM)]) });
  assert(gate.ok, '出发地点与第一个地点齐备时应放行');
  if (gate.ok) {
    assert(gate.origin !== null, '有已保存出发地点时 origin 不应为空');
    assert(gate.origin !== null && gate.origin.latitude === 23.1 && gate.origin.longitude === 113.2, 'origin 应取默认出发点坐标');
    assert(gate.origin !== null && gate.origin.place.id === 'p_home', 'origin 应保留原始出发地点');
    assert(gate.destinationName === '广州羽毛球中心羽毛球馆', 'destinationName 应取第一个地点名');
    assert(gate.destination.id === 'loc_gym', 'destination 应保留原始 Location');
  }

  // 目的地名带空白：查询词裁剪，原始 Location 不被改写
  const padded = resolvePersonalRouteGate({
    departurePlaces: [HOME],
    plan: plan([event('e1', place('loc_pad', '  越南菜餐厅  ', 23.14, 113.33))]),
  });
  assert(padded.ok && padded.destinationName === '越南菜餐厅', 'destinationName 应裁剪首尾空白');
  assert(padded.ok && padded.destination.name === '  越南菜餐厅  ', '原始 Location 名称不应被改写');
}

console.log('✅ personal-route.test.ts 全部通过');
