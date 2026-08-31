// types/plan.ts
// 计划：必须完全结构化，禁止 plan: string。

import { PlanEvent } from './event';
import { Price } from './price';

export type PlanConflictType = 'TIME_CONFLICT' | 'LOCATION_CONFLICT' | 'BUDGET_CONFLICT' | 'OTHER';

export interface PlanConflict {
  id: string;
  type: PlanConflictType;
  /** 冲突描述 */
  description: string;
  /** 涉及的约束 id */
  constraintIds: string[];
  /** 建议的调整方案 */
  suggestions?: string[];
}

/** 计划规划上下文：由约束推导出的规划目标 */
export interface PlanningContext {
  /** 预算目标 */
  budgetTarget?: {
    maxPerPerson?: number;
    preference?: 'LOW_COST' | 'HIGH_QUALITY';
  };
  /** 参与者可用时间窗口（ISO 8601） */
  availabilityWindows?: Array<{
    ownerId: string;
    availableAfter?: string;
    availableUntil?: string;
  }>;
}

export interface Plan {
  id: string;
  tripId: string;
  version: number;
  events: PlanEvent[];
  /**
   * AI Trip Pipeline V2：INITIAL_GENERATION 首版行程的结构化概述。
   * 由服务端生成并落库；本地规则引擎产出的计划不带该字段。
   */
  summary?: string;
  estimatedTotalPrice?: Price;
  satisfiedConstraintCount: number;
  totalConstraintCount: number;
  conflicts: PlanConflict[];
  /** 规划上下文 */
  planningContext?: PlanningContext;
  updatedAt: string;
}