// types/route-option.ts
// 路线方案 ViewModel：「我的推荐」路线选择器的内部数据模型。
// 边界：Map Provider Response → Map Adapter → RouteOption[] → UI。
// UI 只依赖本文件，绝不直接消化腾讯地图原始 response。

/** 单段交通方式 */
export type RouteTransportMode =
  | 'WALK'
  | 'METRO'
  | 'BUS'
  | 'TAXI'
  | 'DRIVE'
  | 'BIKE';

/** 路线步骤：时间轴上的一个节点或一段交通 */
export interface RouteStep {
  type: 'WALK' | 'TRANSIT' | 'DRIVE' | 'BIKE' | 'ARRIVAL';
  /** 节点标题，如「当前位置」「体育西路」 */
  title: string;
  /** 补充说明，如线路名「地铁 3 号线」 */
  subtitle?: string;
  durationMinutes?: number;
  distanceMeters?: number;
  latitude?: number;
  longitude?: number;

  // ---- Provider 信息保留区 ----
  // 以下字段仅当腾讯 Direction API 真实返回时才有值；缺失即保持 undefined，
  // 由 UI 有意义地隐藏。禁止在数据层或展示层编造任何取值。

  /** 步行段：完整指引原文（未截断），如「沿体育东路向南步行至体育西路站入口」 */
  instruction?: string;
  /** 步行段：道路名（road_name） */
  roadName?: string;
  /** 步行段：方向描述（dir_desc），如「向南」 */
  directionDesc?: string;
  /** 步行段：动作描述（act_desc），如「左转」 */
  actionDesc?: string;

  /** 乘车段：线路 ID（provider 原始值的字符串形式） */
  lineId?: string;
  /** 乘车段：线路名（lines[].title，如「地铁3号线」） */
  lineTitle?: string;
  /** 乘车段：运行方向终点站（destination/direction 字段的站名），如「广州东站」 */
  towardsStation?: string;
  /** 乘车段：上车站名（geton.title） */
  getonStation?: string;
  /** 乘车段：下车站名（getoff.title） */
  getoffStation?: string;
  /** 乘车段：乘坐站数（station_count） */
  stationCount?: number;
  /**
   * 乘车段：交通子模式（provider vehicle 字段的语义化结果：
   * SUBWAY → METRO，含「地铁/号线」名称启发式 → METRO，其余 BUS）。
   * UI 据此选择地铁/公交图标。
   */
  transportMode?: RouteTransportMode;
  /**
   * 乘车段：线路运行状态原始值（run_status）。
   * 仅原样保存 provider 取值；官方枚举语义确认之前 UI 不解读、不展示，
   * 防止把未知编码误报为异常（产品不变量 2/8：不虚构、不推断）。
   */
  runStatus?: string;
  /** 分段票价：provider 返回且为正数时换算填充（与 RouteOption.estimatedCost 同构） */
  estimatedCost?: {
    amount: number;
    currency: string;
  };
}

/** 一条完整路线方案 */
export interface RouteOption {
  id: string;
  /** 是否推荐方案（provider 排序第一条；不自行发明排序算法） */
  recommended: boolean;
  durationMinutes: number;
  distanceMeters?: number;
  departureTime?: string;
  arrivalTime?: string;
  /** 仅当 provider 返回可信票价时填充，绝不猜测 */
  estimatedCost?: {
    amount: number;
    currency: string;
  };
  /** 方案特点标签（如「少换乘」「时间短」），仅 provider 提供时才有值 */
  summary?: string;
  modes: RouteTransportMode[];
  steps: RouteStep[];
}

/** 目的地解析结果：地点名 → 坐标 */
export interface ResolvedDestination {
  name: string;
  latitude: number;
  longitude: number;
}

/** 路线规划请求 */
export interface RoutePlanQuery {
  /** 出发地坐标（用户授权定位后提供）；缺失时由服务实现决定行为 */
  origin?: {
    latitude: number;
    longitude: number;
  };
  /** 计划中的目的地名称，需先经 POI 搜索解析为坐标 */
  destinationName: string;
  /** 城市（默认取地图配置） */
  city?: string;
  /** 期望出发时间（ISO-8601），可空表示尽快出发 */
  departureTime?: string;
}

/** 路线规划结果：最多 3 条、已按推荐排序 */
export interface RoutePlanResult {
  options: RouteOption[];
  resolvedDestination?: ResolvedDestination;
}

/** 路线服务错误码：UI 据此映射失败态，绝不静默回退假数据 */
export type RouteOptionErrorCode =
  | 'NOT_CONFIGURED'
  | 'PERMISSION_DENIED'
  | 'LOCATION_UNAVAILABLE'
  | 'GEOCODE_FAILED'
  | 'NO_ROUTE'
  | 'NETWORK_ERROR'
  | 'PROVIDER_ERROR';

/** 路线方案服务接口：real 实现失败必须真实抛错 */
export interface RouteOptionService {
  planRoutes(query: RoutePlanQuery): Promise<RoutePlanResult>;
}
