// types/constraint.ts
// 约束：AI 将自然语言解析为结构化约束。

export type ConstraintType =
  | 'TIME'
  | 'LOCATION'
  | 'BUDGET'
  | 'AVAILABILITY'
  | 'PREFERENCE';

export type ConstraintPriority = 'HARD' | 'SOFT';

export interface Constraint {
  id: string;
  tripId: string;
  ownerId: string;
  /** 来源评论 id */
  sourceCommentId?: string;
  type: ConstraintType;
  /** 作用范围，如 TRIP / EVENT */
  scope: string;
  priority: ConstraintPriority;
  /** 结构化值，如 { max: 80, currency: 'CNY' } */
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