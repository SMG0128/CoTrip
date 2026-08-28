// utils/personal-route.ts
// 「我的推荐」请求门禁：只规划「出发地点 → 计划第一个地点」。
//
// 产品规则（V1）：
// - 仅要求计划第一个地点已就绪才允许规划——缺首地点 → 「行程未生成」
//   （等 AI 把想法整理成计划），门禁在任何 provider 请求之前完成；
// - 出发地点不再是硬前提：首地点就绪后，面板初开为「请选择出发地点」
//   两个按钮（使用保存地点 / 地图选点），由用户显式选点后才发起规划（不自动调用）；
// - 本函数只回答「首地点是否就绪 + 是否有可复用的已保存出发点」，不发起任何请求。
//
// 出发地点是个人隐私数据（产品不变量 6：共享计划 + 个人路线），
// 只用于计算本人路线，不进入共享计划、不上报后端。
// 纯函数（无 wx 依赖），可在 Node 中单测。

import { Location } from '../types/location';
import { Plan } from '../types/plan';

/** 缺计划第一个地点的面板文案 */
export const NO_FIRST_LOCATION_TEXT = '行程未生成';

/** 门禁拦截原因：现在只有「缺第一个地点」一种（出发地点改为面板内选点，不再拦截） */
export type PersonalRouteBlockReason = 'NO_FIRST_LOCATION';

/** 已校验坐标的出发点：latitude / longitude 收窄为有限数值，调用方无需再断言 */
export interface DeparturePoint {
  place: Location;
  latitude: number;
  longitude: number;
}

/** 门禁通过：首地点已就绪，允许进入「选出发点 → 规划」流程（是否自动调用由调用方决定） */
export interface PersonalRouteReady {
  ok: true;
  /** 已保存的默认出发地点（可能为空：面板「使用保存地点」不可用，需地图选点补足） */
  origin: DeparturePoint | null;
  /** 计划中的第一个地点（原始 Location，保留 provider 信息） */
  destination: Location;
  /** 直接可传给 RoutePlanQuery.destinationName */
  destinationName: string;
}

/** 门禁拦截：绝不调用路线服务，只给出可执行的下一步文案 */
export interface PersonalRouteBlocked {
  ok: false;
  reason: PersonalRouteBlockReason;
  message: string;
}

export type PersonalRouteGate = PersonalRouteReady | PersonalRouteBlocked;

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 默认出发点：列表首位即默认，但没有可用坐标的条目无法作为路线起点，
 * 因此顺序向后取第一条坐标合法的记录（仍是用户自己保存的地点，不伪造坐标）。
 */
export function resolveDefaultDeparturePlace(places: Location[]): DeparturePoint | null {
  for (const place of places) {
    if (isFiniteNumber(place.latitude) && isFiniteNumber(place.longitude)) {
      return { place, latitude: place.latitude, longitude: place.longitude };
    }
  }
  return null;
}

/**
 * 计划的「第一个地点」：按事件顺序取第一个带有效地点名的 event.location。
 * 地点名是路线服务解析目的地的唯一输入，空名视为没有地点。
 */
export function resolveFirstPlanLocation(plan: Plan | undefined): Location | null {
  for (const event of plan?.events ?? []) {
    const location = event.location;
    if (location && location.name.trim().length > 0) return location;
  }
  return null;
}

/**
 * 「我的推荐」门禁（V1 规则）：
 * 只要求计划第一个地点已就绪；出发地点降级为「使用保存地点」候选（可为空），
 * 真正的选点与发起调用由页面在面板内完成（使用保存地点 / 地图选点），此处不发起请求。
 */
export function resolvePersonalRouteGate(input: {
  departurePlaces: Location[];
  plan: Plan | undefined;
}): PersonalRouteGate {
  const destination = resolveFirstPlanLocation(input.plan);
  if (!destination) {
    return {
      ok: false,
      reason: 'NO_FIRST_LOCATION',
      message: NO_FIRST_LOCATION_TEXT,
    };
  }

  return {
    ok: true,
    origin: resolveDefaultDeparturePlace(input.departurePlaces),
    destination,
    destinationName: destination.name.trim(),
  };
}
