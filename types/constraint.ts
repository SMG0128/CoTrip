// types/constraint.ts
// 约束：AI 将自然语言解析为结构化约束。

export type ConstraintType =
  | 'TIME'
  | 'LOCATION'
  | 'BUDGET'
  | 'AVAILABILITY'
  | 'PREFERENCE';

export type ConstraintPriority = 'HARD' | 'SOFT';

/** 约束作用范围 */
export type ConstraintScope = 'TRIP' | 'SPORT' | 'DINING' | 'TRANSPORT' | 'ENTERTAINMENT' | 'OTHER';

/** Availability / Deadline 约束值 */
export interface AvailabilityConstraintValue {
  /** 最早可用时间（ISO 8601） */
  availableAfter?: string;
  /** 最晚必须离开时间（ISO 8601） */
  availableUntil?: string;
}

/** Location 约束值 */
export interface LocationConstraintValue {
  district?: string;
  city?: string;
  locationId?: string;
}

/** Budget 约束值 */
export interface BudgetConstraintValue {
  max?: number;
  min?: number;
  currency?: 'CNY';
  unit?: 'TOTAL' | 'PER_PERSON' | 'PER_HOUR';
  /** 预算偏好，如 LOW_COST */
  preference?: 'LOW_COST' | 'HIGH_QUALITY';
}

/** Preference 约束值 */
export interface PreferenceConstraintValue {
  /** 偏好关键词，如 VIETNAMESE / METRO / NEARBY */
  keyword?: string;
  note?: string;
}

export interface Constraint {
  id: string;
  tripId: string;
  ownerId: string;
  /** 来源评论 id，必须可追溯 */
  sourceCommentId?: string;
  type: ConstraintType;
  /** 作用范围，如 TRIP / SPORT / DINING */
  scope: ConstraintScope;
  priority: ConstraintPriority;
  /** 结构化值 */
  value: Record<string, unknown>;
}

/** 区域限定（新建行程可选） */
export interface AreaConstraint {
  /** 不限区域 */
  unrestricted?: boolean;
  /** 指定地点 */
  location?: import('./location').Location;
  /** 指定行政区域 */
  district?: string;
  city?: string;
  /** 地图范围（预留） */
  mapBounds?: {
    northeast: { latitude: number; longitude: number };
    southwest: { latitude: number; longitude: number };
  };
}