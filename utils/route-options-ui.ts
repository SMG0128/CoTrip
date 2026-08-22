// utils/route-options-ui.ts
// 「我的推荐」路线方案选择器的 UI 纯函数层：
// 手风琴状态机 + 摘要卡文案格式化 + 导航目标解析 + 错误码→中文文案映射。
// 全部为纯函数（无 wx / Page 依赖），可被 Node 测试直接覆盖。

import {
  ResolvedDestination,
  RouteOption,
  RouteStep,
  RouteTransportMode,
} from '../types/route-option';

/**
 * 手风琴状态机：计算点击后的展开索引。
 *
 * 不变量：至少恒有一条展开——返回值永不为 null。
 * 规则：
 * - 点已展开项 → 保持该索引不变（不允许收起成空态）
 * - 点其他项 → 切换到该项；前一项由单值索引状态天然自动收起
 * - 当前无展开（null，仅理论初态）→ 展开点击项
 */
export function resolveNextExpandedIndex(
  currentExpanded: number | null,
  clickedIndex: number
): number {
  if (currentExpanded !== null && currentExpanded === clickedIndex) {
    return currentExpanded;
  }
  return clickedIndex;
}

/** 交通方式中文标签（第二行 modes 连接用） */
const ROUTE_MODE_LABELS: Record<RouteTransportMode, string> = {
  WALK: '步行',
  METRO: '地铁',
  BUS: '公交',
  TAXI: '打车',
  DRIVE: '驾车',
  BIKE: '骑行',
};

export function routeModeLabel(mode: RouteTransportMode): string {
  return ROUTE_MODE_LABELS[mode];
}

/** 第二行 modes 中文连接：去重保序，如「地铁 + 步行」 */
export function formatRouteModesLine(modes: RouteTransportMode[]): string {
  const seen = new Set<RouteTransportMode>();
  const labels: string[] = [];
  for (const mode of modes) {
    if (seen.has(mode)) continue;
    seen.add(mode);
    labels.push(ROUTE_MODE_LABELS[mode]);
  }
  return labels.join(' + ');
}

/**
 * ISO-8601 时刻 → 东八区 HH:mm 展示。
 * 数据层的推算结果可能是 UTC（Z 结尾）或带偏移的本地时间：统一解析为时刻后
 * 换算到 Asia/Shanghai（V1 全量固定时区），避免直接切片导致 -8h 显示错误。
 * 缺失/非法时显示「—」（绝不猜测时间）。
 */
export function formatIsoTimeShort(iso: string | undefined): string {
  if (typeof iso !== 'string') return '—';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const shanghaiWallClock = new Date(ms + 8 * 60 * 60 * 1000);
  return shanghaiWallClock.toISOString().slice(11, 16);
}

/** 第三行「10:36 → 11:27 · 约 ¥6」；缺时间的显示「—」，缺票价的只显示时间段 */
export function formatRouteScheduleLine(
  option: Pick<RouteOption, 'departureTime' | 'arrivalTime' | 'estimatedCost'>
): string {
  const timePart = `${formatIsoTimeShort(option.departureTime)} → ${formatIsoTimeShort(
    option.arrivalTime
  )}`;
  const costPart = option.estimatedCost ? ` · 约 ¥${option.estimatedCost.amount}` : '';
  return `${timePart}${costPart}`;
}

/** 展开详情底部到达行：「11:27 到达」；缺时间退化为「预计到达」 */
export function formatRouteArrivalFooter(arrivalTime: string | undefined): string {
  const hhmm = formatIsoTimeShort(arrivalTime);
  return hhmm === '—' ? '预计到达' : `${hhmm} 到达`;
}

/** 时间轴节点类型中文标签（步骤说明首段） */
const ROUTE_STEP_TYPE_LABELS: Record<RouteStep['type'], string> = {
  WALK: '步行',
  TRANSIT: '乘车',
  DRIVE: '驾车',
  BIKE: '骑行',
  ARRIVAL: '到达',
};

export function routeStepTypeLabel(type: RouteStep['type']): string {
  return ROUTE_STEP_TYPE_LABELS[type];
}

/** 距离展示：≥1km 显示公里（一位小数），否则显示整米 */
export function formatRouteDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} 公里` : `${Math.round(meters)} 米`;
}

/** 单个步骤的说明行：如「步行 · 8 分钟 · 600 米」 */
export function formatRouteStepDesc(step: RouteStep): string {
  const parts: string[] = [ROUTE_STEP_TYPE_LABELS[step.type]];
  if (typeof step.durationMinutes === 'number') {
    parts.push(`${step.durationMinutes} 分钟`);
  }
  if (typeof step.distanceMeters === 'number') {
    parts.push(formatRouteDistance(step.distanceMeters));
  }
  return parts.join(' · ');
}

/**
 * 解析「去导航」目标坐标：取最后一个带坐标的 step（通常是目的地节点），
 * 其次 resolvedDestination；两者都无坐标则返回 null（由页面 toast 提示，绝不伪造坐标）。
 */
export function extractNavigateTarget(
  option: RouteOption,
  resolvedDestination?: ResolvedDestination | null
): { latitude: number; longitude: number; name: string } | null {
  for (let i = option.steps.length - 1; i >= 0; i -= 1) {
    const step = option.steps[i];
    if (typeof step.latitude === 'number' && typeof step.longitude === 'number') {
      return { latitude: step.latitude, longitude: step.longitude, name: step.title };
    }
  }
  if (resolvedDestination) {
    return {
      latitude: resolvedDestination.latitude,
      longitude: resolvedDestination.longitude,
      name: resolvedDestination.name,
    };
  }
  return null;
}

/**
 * 路线服务错误 → 用户可读中文文案映射。
 * 错误对象按 `{ code }` 结构鸭子识别（RouteOptionError），避免耦合实现文件路径。
 */
export function resolveRouteErrorText(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  switch (code) {
    case 'NOT_CONFIGURED':
      return '暂未配置地图服务';
    case 'GEOCODE_FAILED':
      return '暂时无法定位这个地点';
    case 'NO_ROUTE':
      return '暂无可达路线';
    default:
      // PERMISSION_DENIED / LOCATION_UNAVAILABLE / NETWORK_ERROR / PROVIDER_ERROR 及未知错误
      return '暂时无法规划路线，稍后重试';
  }
}
