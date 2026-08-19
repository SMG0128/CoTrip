// core/planning-engine.ts
// 规划引擎：编排完整数据链路
//   Comment → Constraint Extraction → Constraint Store → Conflict Detection
//   → Plan Reconciliation → Structured Plan
// 纯同步逻辑，不依赖微信运行时，便于单元测试。

import { Comment } from '../types/comment';
import { Constraint } from '../types/constraint';
import { Plan, PlanConflict } from '../types/plan';
import { PlanEvent } from '../types/event';
import { parseComments, ParseContext } from './constraint-parser';
import { ConstraintStore } from './constraint-store';
import { detectConflicts } from './conflict-detector';
import { reconcilePlan } from './plan-reconciler';

export interface PlanningEngineOptions {
  tripId: string;
  tripDate?: string;
  timezone?: string;
  /** 初始计划（可选） */
  initialPlan?: Plan;
}

export interface PlanningResult {
  plan: Plan;
  constraints: Constraint[];
  conflicts: PlanConflict[];
  /** 无法解析的评论 id */
  unresolvedCommentIds: string[];
  /** 本次新增/更新的约束 */
  addedConstraints: Constraint[];
}

export class PlanningEngine {
  private store: ConstraintStore;
  private currentPlan?: Plan;
  private readonly ctx: ParseContext;

  constructor(options: PlanningEngineOptions) {
    this.store = new ConstraintStore();
    this.currentPlan = options.initialPlan;
    this.ctx = {
      tripId: options.tripId,
      tripDate: options.tripDate,
      timezone: options.timezone || 'Asia/Shanghai',
    };
  }

  /** 当前约束存储 */
  get constraintStore(): ConstraintStore {
    return this.store;
  }

  /** 当前计划 */
  get plan(): Plan | undefined {
    return this.currentPlan;
  }

  /**
   * 处理一批评论：解析 → 存储 → 冲突检测 → 计划协调。
   * 返回完整规划结果。
   */
  processComments(comments: Comment[]): PlanningResult {
    // 1. 约束提取
    const { constraints, unresolvedCommentIds } = parseComments(comments, this.ctx);

    // 2. 约束存储（去重合并）
    const addedConstraints = this.store.addAll(constraints);

    // 3. 冲突检测
    const allConstraints = this.store.getAll();
    const conflicts = detectConflicts({
      constraints: allConstraints,
      events: this.currentPlan?.events,
    });

    // 4. 计划协调
    const plan = reconcilePlan({
      currentPlan: this.currentPlan,
      constraints: allConstraints,
      conflicts,
      tripId: this.ctx.tripId,
    });
    this.currentPlan = plan;

    return {
      plan,
      constraints: allConstraints,
      conflicts,
      unresolvedCommentIds,
      addedConstraints,
    };
  }

  /** 移除某条评论及其约束，重新规划 */
  removeComment(commentId: string): PlanningResult | undefined {
    this.store.removeByCommentId(commentId);
    const allConstraints = this.store.getAll();
    const conflicts = detectConflicts({
      constraints: allConstraints,
      events: this.currentPlan?.events,
    });
    const plan = reconcilePlan({
      currentPlan: this.currentPlan,
      constraints: allConstraints,
      conflicts,
      tripId: this.ctx.tripId,
    });
    this.currentPlan = plan;
    return {
      plan,
      constraints: allConstraints,
      conflicts,
      unresolvedCommentIds: [],
      addedConstraints: [],
    };
  }

  /** 重置引擎 */
  reset(): void {
    this.store.clear();
    this.currentPlan = undefined;
  }
}