// utils/route-options-ui.ts
// Route Picker 纯函数展示层（无 wx 依赖，可在 Node 中单测）。
//
// 结构原则（与产品 spec 一致）：
// - Route Row + Vertically Stacked Travel Legs：路线行是一级结构，展开后直接纵向堆叠
//   交通腿；不做贯穿式 timeline / 流程图。
// - 顺序由页面纵向排列天然表达，不绘制 connector 竖线。
// - 折叠态摘要 = 按真实 leg 顺序的单行链（段间 › 分隔）；
//   乘车段显示紧凑 badge，步行段显示真实分腿时长，纯步行路线合并为总时长段。
//   图标仍以辅助识别为主：仅 WALK/METRO/BUS 有专用图标，其余回退 generic。
// - Provider-first：destination / lineTitle / geton / getoff / stationCount /
//   towardsStation / estimatedCost 等一律「有值才展示」，缺失即空串，绝不编造。
// - 展示归一化：formatTransitLineLabel 只做「去除重复交通前缀」的确定性改写
//   （地铁APM线 → APM线），Provider raw 值始终保留在 semantic DTO，绝不反写。
// - 防御式：undefined / null / NaN / 0 / 负数 → 空串或安全值，不泄漏 --/undefined。

import { ResolvedDestination, RouteOption, RouteStep } from '../types/route-option';
import { buildGuangzhouMetroBadgePresentation } from './guangzhou-metro';

export type RouteMode = 'WALK' | 'METRO' | 'BUS' | 'TAXI' | 'DRIVE' | 'BIKE';
export type RouteStepType = 'WALK' | 'TRANSIT' | 'DRIVE' | 'BIKE' | 'ARRIVAL';

/** 手风琴：点击当前展开项 → null（全部收起）；点击其他项 → 切换到该索引。
 *  单值索引状态天然满足「同一时刻最多一条展开」，且允许 0 条。 */
export function resolveNextExpandedIndex(
  currentExpanded: number | null,
  clickedIndex: number
): number | null {
  return currentExpanded === clickedIndex ? null : clickedIndex;
}

const ROUTE_MODE_LABELS: Partial<Record<RouteMode, string>> = {
  WALK: '步行',
  METRO: '地铁',
  BUS: '公交',
  TAXI: '打车',
  DRIVE: '驾车',
  BIKE: '骑行',
};

const ROUTE_STEP_TYPE_LABELS: Record<RouteStepType, string> = {
  WALK: '步行',
  TRANSIT: '乘车',
  DRIVE: '驾车',
  BIKE: '骑行',
  ARRIVAL: '到达',
};

export const ROUTE_GENERIC_ICON = '/assets/icons/route/generic.svg';
export const COTRIP_TRANSIT_BLUE = '#326BFF';
export const TRANSIT_BADGE_LIGHT_TEXT = '#FFFFFF';
const ROUTE_ICONS: Record<RouteMode, string> = {
  WALK: '/assets/icons/route/walk.svg',
  METRO: '/assets/icons/route/metro.svg',
  BUS: '/assets/icons/route/bus.svg',
  TAXI: '/assets/icons/route/generic.svg',
  DRIVE: '/assets/icons/route/generic.svg',
  BIKE: '/assets/icons/route/generic.svg',
};

// ---------------------------------------------------------------------------
// 基础文案
// ---------------------------------------------------------------------------

export function routeModeLabel(mode: RouteMode | undefined): string {
  return mode ? (ROUTE_MODE_LABELS[mode] ?? '乘车') : '乘车';
}

export function routeStepTypeLabel(type: RouteStepType | undefined): string {
  return type ? (ROUTE_STEP_TYPE_LABELS[type] ?? '') : '';
}

/** 去除线路名中冗余的交通前缀（展示层归一化）。 */
export function formatTransitLineLabel(raw: string | undefined): string {
  if (!raw) return '';
  const normalized = raw.replace(/^(地铁|公交|轻轨)\s*/, '');
  return normalized.length > 0 ? normalized : raw;
}

// ---------------------------------------------------------------------------
// 时间 / 距离 / 价格
// ---------------------------------------------------------------------------

/** 转 ISO 时间 → 东八区 HH:MM（12:34）。无值/非法值返回「—」。 */
export function formatIsoTimeShort(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  // 小程序当前业务时区固定为 Asia/Shanghai；显式加 UTC+8 后读取 UTC 字段，
  // 避免 Node/服务器本机时区影响展示与测试结果。
  const shanghai = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  const h = shanghai.getUTCHours();
  const m = shanghai.getUTCMinutes();
  return `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}`;
}

/** 预计到达脚注：有真实 arrival 时间显示「HH:MM 到达」；无值退化为「预计到达」，
 *  绝不编造具体时刻。 */
export function formatRouteArrivalFooter(iso: string | undefined): string {
  const t = formatIsoTimeShort(iso);
  return t === '—' ? '预计到达' : `${t} 到达`;
}

/** 总时长：仅当为正有限数值时输出「N 分钟」（0/负数/NaN/缺失一律空串）。 */
export function formatRouteDuration(minutes: number | undefined): string {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return '';
  return `${Math.round(minutes)} 分钟`;
}

/** 总价：结构化 Price → 「¥N」（金额缺失时用 range；0/NaN/负数视为无票价）。 */
export function formatRouteCost(
  cost: { amount?: number; min?: number; max?: number; currency?: string } | undefined
): string {
  if (!cost) return '';
  if (typeof cost.amount === 'number' && Number.isFinite(cost.amount) && cost.amount > 0) {
    return `¥${cost.amount}`;
  }
  if (
    typeof cost.min === 'number' &&
    Number.isFinite(cost.min) &&
    cost.min > 0 &&
    typeof cost.max === 'number' &&
    Number.isFinite(cost.max) &&
    cost.max > 0
  ) {
    return `¥${cost.min}-${cost.max}`;
  }
  return '';
}

/** 距离：非负数值 → 「N 米」/「N.X 公里」；无值空串。 */
export function formatRouteDistance(meters: number | undefined): string {
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters < 0) return '';
  if (meters < 1000) return `${Math.round(meters)} 米`;
  return `${(meters / 1000).toFixed(1)} 公里`;
}

/** 步骤时长：复用总时长规则（正有限数值 → 「N 分钟」）。 */
function formatStepDuration(minutes: number | undefined): string {
  return formatRouteDuration(minutes);
}

// ---------------------------------------------------------------------------
// 折叠态摘要分段链（Route Summary Segments）
// 按真实 leg 顺序生成 inline segment；WXML 只负责 render，不做规则判断。
// ---------------------------------------------------------------------------

/** 折叠态摘要段：步行显示紧凑文本，乘车显示原生 badge，段间 › 分隔。
 *  顺序 = Provider 返回的真实 leg 顺序，绝不合并 / 重排。
 *  仅使用真实字段（duration / lineTitle / transportMode），禁止编造。 */
export interface RouteSummarySegment {
  /** 展示 key（type_index），供 wx:for 稳定复用 */
  key: string;
  /** WALK / METRO / BUS / DRIVE / BIKE；未知名乘车段为 undefined */
  mode: RouteMode | undefined;
  /** 段文案：步行 / APM 线 / 810 路（乘车段 = 归一化线路名，缺失回退交通方式标签） */
  label: string;
  /** 步行等非乘车段：真实分腿时长（「8 分钟」）；乘车段保持空（只显示线路，保持 compact） */
  durationText: string;
  /** 非 badge 段的单一紧凑文本（如「步行 8分钟」） */
  compactText: string;
  /** 模式图标：仅 WALK/METRO/BUS 有专用图标，其余回退 generic */
  iconUrl: string;
  /** 乘车腿的原生小徽章；缺线路名时为 null，绝不编造线路 */
  badge: TransitBadgePresentation | null;
}

export interface RoutePresentationContext {
  city?: string;
}

export interface TransitBadgePresentation {
  kind: 'METRO' | 'BUS';
  text: string;
  backgroundColor: string;
  foregroundColor: string;
  /** LOCAL_GUANGZHOU = 本地广州线色；SEMANTIC = CoTrip 通用交通色 */
  source: 'LOCAL_GUANGZHOU' | 'SEMANTIC';
}

function isGuangzhouContext(context: RoutePresentationContext): boolean {
  return context.city?.trim().replace(/市$/, '') === '广州';
}

/** 只移除简单数字/编码公交线尾部的「路」；特殊专线名保留 Provider 原意。 */
export function normalizeBusLineTitle(rawTitle: string): string {
  const trimmed = rawTitle.trim().replace(/^公交\s*/, '');
  const simpleRoute = trimmed.match(/^([A-Za-z]*\d+[A-Za-z]?)路$/i);
  return simpleRoute ? simpleRoute[1] : trimmed;
}

export function buildTransitBadgePresentation(
  step: Pick<RouteStep, 'lineTitle' | 'transportMode'>,
  context: RoutePresentationContext = {}
): TransitBadgePresentation | null {
  const rawTitle = step.lineTitle?.trim();
  if (!rawTitle) return null;

  if (step.transportMode === 'BUS') {
    const text = normalizeBusLineTitle(rawTitle);
    if (!text) return null;
    return {
      kind: 'BUS',
      text,
      backgroundColor: COTRIP_TRANSIT_BLUE,
      foregroundColor: TRANSIT_BADGE_LIGHT_TEXT,
      source: 'SEMANTIC',
    };
  }

  if (step.transportMode === 'METRO') {
    if (isGuangzhouContext(context)) {
      const local = buildGuangzhouMetroBadgePresentation(rawTitle);
      if (local) {
        return {
          kind: 'METRO',
          text: local.text,
          backgroundColor: local.backgroundColor,
          foregroundColor: local.foregroundColor,
          source: 'LOCAL_GUANGZHOU',
        };
      }
    }
    return {
      kind: 'METRO',
      text: formatTransitLineLabel(rawTitle),
      backgroundColor: COTRIP_TRANSIT_BLUE,
      foregroundColor: TRANSIT_BADGE_LIGHT_TEXT,
      source: 'SEMANTIC',
    };
  }

  return null;
}

/** 提取单个非 ARRIVAL step 的摘要段。 */
function buildSummarySegment(
  step: RouteStep,
  index: number,
  context: RoutePresentationContext
): RouteSummarySegment {
  const mode = resolveStepMode(step);
  const isTransit = step.type === 'TRANSIT';
  // 摘要只认真实线路名（lineTitle）；不把步骤 title（可能是站名）当作线路名；
  // 无线路名时回退交通方式标签（地铁/公交/乘车），绝不编造。
  const label = isTransit
    ? formatTransitLineLabel(step.lineTitle) ||
      (mode ? routeModeLabel(mode) : routeStepTypeLabel(step.type))
    : routeStepTypeLabel(step.type);
  const durationText = isTransit ? '' : formatStepDuration(step.durationMinutes);
  return {
    key: `seg_${index}_${step.type}`,
    mode,
    label,
    // 乘车段只显示线路（line title 优先于 duration，保持 compact）；
    // 步行等段显示真实分腿时长，缺失时长安全退化为空串（绝不输出「undefined 分钟」）。
    durationText,
    compactText: durationText
      ? `${label} ${durationText.replace(/\s+分钟$/, '分钟')}`
      : label,
    iconUrl: mode ? getRouteModeIcon(mode) : ROUTE_GENERIC_ICON,
    badge: isTransit ? buildTransitBadgePresentation(step, context) : null,
  };
}

/**
 * 折叠态摘要链：按真实 leg 顺序输出 segments。
 * - 纯步行路线合并为单个「步行 N 分钟」段（无换乘顺序可表达，快览总时长）。
 * - 含换乘的链保持全部 leg 顺序（WALK/METRO/WALK 绝不合并、绝不重排）。
 * - 跳过 ARRIVAL；乘车段优先真实线路名（归一化），缺失回退交通方式标签。
 */
export function buildRouteSummarySegments(
  option: RouteOption,
  context: RoutePresentationContext = {}
): RouteSummarySegment[] {
  const legs = option.steps.filter((step) => step.type !== 'ARRIVAL');
  if (legs.length > 0 && legs.every((step) => step.type === 'WALK')) {
    return [
      {
        key: 'seg_walk_total',
        mode: 'WALK',
        label: '步行',
        durationText: formatRouteDuration(option.durationMinutes),
        compactText: `步行 ${formatRouteDuration(option.durationMinutes).replace(/\s+分钟$/, '分钟')}`.trim(),
        iconUrl: getRouteModeIcon('WALK'),
        badge: null,
      },
    ];
  }
  return legs.map((step, index) => buildSummarySegment(step, index, context));
}

/**
 * 折叠态紧凑摘要：保留 Provider leg 顺序，只做展示层拼接。
 * 长度裁切由固定头部内的 CSS ellipsis 负责，此处不破坏任何真实线路名。
 */
export function buildCompactRouteSummary(
  option: RouteOption,
  context: RoutePresentationContext = {}
): string {
  return buildRouteSummarySegments(option, context)
    .map((segment) => segment.badge?.text ?? segment.compactText)
    .join(' › ');
}

// ---------------------------------------------------------------------------
// Route Row 视图模型
// ---------------------------------------------------------------------------

export interface RouteRowView {
  id: string;
  raw: RouteOption;
  recommended: boolean;
  /** 路线 1 / 路线 2 / 路线 3（身份行统一显示；推荐由 recommended + badge 表达） */
  labelText: string;
  /** 折叠态分段链（按真实 leg 顺序；纯步行合并为总时长段） */
  summarySegments: RouteSummarySegment[];
  /** 供 WXML 直接渲染的单行紧凑摘要 */
  summaryText: string;
  /** 总时长（最高视觉权重） */
  durationText: string;
  /** 总价（secondary metadata） */
  costText: string;
  /** Provider 特性标签（少换乘 等），仅 mock/可信字段时存在 */
  featureText: string;
}

export function buildRouteLabelText(index: number): string {
  return `路线 ${index + 1}`;
}

export function buildRouteRowVMs(
  options: RouteOption[],
  context: RoutePresentationContext = {}
): RouteRowView[] {
  return options.map((option, index) => ({
    id: option.id,
    raw: option,
    recommended: index === 0,
    labelText: buildRouteLabelText(index),
    summarySegments: buildRouteSummarySegments(option, context),
    summaryText: buildCompactRouteSummary(option, context),
    durationText: formatRouteDuration(option.durationMinutes),
    costText: formatRouteCost(option.estimatedCost),
    featureText: option.summary ?? '',
  }));
}

// ---------------------------------------------------------------------------
// Travel Leg 视图模型（WALK / METRO / BUS 统一三行结构）
// ---------------------------------------------------------------------------

export interface RouteLegView {
  key: string;
  /** walk | accent —— 步行 neutral 灰底；乘车统一 CoTrip accent（禁本地线路色） */
  toneClass: string;
  iconPath: string;
  /** 乘车腿复用折叠摘要的线路 badge；步行/驾车等为 null */
  transitBadge: TransitBadgePresentation | null;
  /** WALK=步行；TRANSIT=归一化线路名（APM线），缺线路名回退交通方式标签 */
  titleText: string;
  /** 右侧固定列 */
  durationText: string;
  /** 第二行：WALK=距离；TRANSIT=上车 → 下车（或 subtitle 回退） */
  metricText: string;
  /** 第三行：WALK=指引；TRANSIT=往 X 方向 · 乘 N 站 */
  detailText: string;
}

export function buildRouteLeg(
  step: RouteStep,
  index: number,
  context: RoutePresentationContext = {}
): RouteLegView {
  const mode = resolveStepMode(step);
  const isTransit = step.type === 'TRANSIT';
  const iconPath = mode ? getRouteModeIcon(mode) : ROUTE_GENERIC_ICON;
  const durationText = formatStepDuration(step.durationMinutes);
  const distanceText = formatRouteDistance(step.distanceMeters);

  let titleText: string;
  let metricText = '';
  let detailText = '';

  if (isTransit) {
    titleText =
      formatTransitLineLabel(step.lineTitle) ||
      formatTransitLineLabel(step.title) ||
      (mode ? routeModeLabel(mode) : routeStepTypeLabel(step.type));
    const onOff = [step.getonStation, step.getoffStation].filter(Boolean);
    metricText =
      onOff.length === 2
        ? `${step.getonStation} → ${step.getoffStation}`
        : onOff.length === 1
          ? (onOff[0] as string)
          : (step.subtitle ?? '');
    // 距离对地铁是低优先级信息，可隐藏（§10）：只组合方向 + 站数。
    detailText = composeMetaParts([
      step.towardsStation ? `往 ${step.towardsStation} 方向` : undefined,
      typeof step.stationCount === 'number' ? `乘 ${step.stationCount} 站` : undefined,
    ]);
  } else {
    titleText = routeStepTypeLabel(step.type);
    metricText = composeMetaParts([distanceText]);
    detailText = composeWalkDesc(step) || step.subtitle || '';
  }

  return {
    key: `leg_${index}_${step.type}`,
    toneClass: mode === 'WALK' ? 'walk' : 'accent',
    iconPath,
    transitBadge: isTransit ? buildTransitBadgePresentation(step, context) : null,
    titleText,
    durationText,
    metricText,
    detailText,
  };
}

export function buildRouteLegs(
  option: RouteOption,
  context: RoutePresentationContext = {}
): RouteLegView[] {
  return option.steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => step.type !== 'ARRIVAL')
    .map(({ step, index }) => buildRouteLeg(step, index, context));
}

// ---------------------------------------------------------------------------
// Route Detail 视图模型（展开区 = legs + destination footer，不重复行级 summary）
// ---------------------------------------------------------------------------

export interface RouteDetailView {
  id: string;
  raw: RouteOption;
  legs: RouteLegView[];
  /** 目的地名称（ARRIVAL step title），缺失空串 */
  destinationText: string;
  /** HH:MM 到达 / 预计到达（缺失时刻时） */
  arrivalText: string;
}

export function buildRouteDetailVM(
  option: RouteOption,
  arrivalIso?: string,
  context: RoutePresentationContext = {}
): RouteDetailView {
  const arrival = option.steps.find((step) => step.type === 'ARRIVAL');
  const iso = arrivalIso ?? option.arrivalTime;
  return {
    id: option.id,
    raw: option,
    legs: buildRouteLegs(option, context),
    destinationText: arrival?.title ?? '',
    arrivalText: formatRouteArrivalFooter(iso),
  };
}

// ---------------------------------------------------------------------------
// 步骤指引文案
// ---------------------------------------------------------------------------

/** 步行指引：完整 instruction 原文优先（Provider-first，不拼 road 前缀）；
 *  无 instruction 时再组合 road + direction。 */
export function composeWalkDesc(step: RouteStep): string {
  if (step.instruction) return step.instruction;
  return [step.roadName ?? '', step.directionDesc ?? ''].filter(Boolean).join('，');
}

/** 多个可选元信息以「 · 」连接，跳过空值。 */
export function composeMetaParts(parts: Array<string | undefined>): string {
  return parts.filter((p): p is string => !!p && p.length > 0).join(' · ');
}

/**
 * 导航目标：最后带坐标 step 优先；其次回退 resolvedDestination；
 * 两者皆无坐标 → null（绝不伪造坐标）。
 */
export function extractNavigateTarget(
  option: RouteOption,
  resolvedDestination?: ResolvedDestination | null
): { name: string; latitude: number; longitude: number } | null {
  for (let i = option.steps.length - 1; i >= 0; i -= 1) {
    const step = option.steps[i];
    if (
      typeof step.latitude === 'number' &&
      Number.isFinite(step.latitude) &&
      typeof step.longitude === 'number' &&
      Number.isFinite(step.longitude)
    ) {
      return { name: step.title, latitude: step.latitude, longitude: step.longitude };
    }
  }
  if (resolvedDestination) {
    return {
      name: resolvedDestination.name,
      latitude: resolvedDestination.latitude,
      longitude: resolvedDestination.longitude,
    };
  }
  return null;
}

/** 步骤说明：类型 · 时长 · 距离（纯展示辅助，Provider-first）。 */
export function formatRouteStepDesc(step: RouteStep): string {
  return composeMetaParts([
    routeStepTypeLabel(step.type) || (step.transportMode ? routeModeLabel(step.transportMode) : undefined),
    formatStepDuration(step.durationMinutes),
    formatRouteDistance(step.distanceMeters),
  ]);
}

export function resolveStepMode(step: RouteStep): RouteMode | undefined {
  if (step.type === 'TRANSIT') {
    return step.transportMode;
  }
  return step.type === 'WALK' || step.type === 'DRIVE' || step.type === 'BIKE' ? (step.type as RouteMode) : undefined;
}

export function getRouteModeIcon(mode: RouteMode): string {
  return ROUTE_ICONS[mode] ?? ROUTE_GENERIC_ICON;
}

// ---------------------------------------------------------------------------
// 错误 / 空态文案
// ---------------------------------------------------------------------------

const ROUTE_ERROR_MESSAGES: Record<string, string> = {
  NOT_CONFIGURED: '暂未配置地图服务',
  GEOCODE_FAILED: '暂时无法定位这个地点',
  NO_ROUTE: '暂无可达路线',
};

export function resolveRouteErrorText(error: unknown): string {
  if (typeof error === 'string' && error.length > 0) return error;
  if (error && typeof error === 'object' && typeof (error as { code?: string }).code === 'string') {
    const message = ROUTE_ERROR_MESSAGES[(error as { code: string }).code];
    if (message) return message;
  }
  return '暂时无法规划路线，稍后重试';
}
