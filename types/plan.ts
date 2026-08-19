// types/plan.ts
// 计划：必须完全结构化，禁止 plan: string。

import { PlanEvent } from './event';
import { Price } from './price';

export interface PlanConflict {
  id: string;
  /** 冲突描述 */
  description: string;
  /** 涉及的约束 id */
  constraintIds: string[];
  /** 建议的调整方案 */
  suggestions?: string[];
}

export interface Plan {
  id: string;
  tripId: string;
  version: number;
  events: PlanEvent[];
  estimatedTotalPrice?: Price;
  satisfiedConstraintCount: number;
  totalConstraintCount: number;
  conflicts: PlanConflict[];
  updatedAt: string;
}