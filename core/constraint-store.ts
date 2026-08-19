// core/constraint-store.ts
// 约束存储：管理行程的约束集合，支持增删查与按来源评论追溯。

import { Constraint } from '../types/constraint';

export class ConstraintStore {
  private constraints: Constraint[] = [];

  constructor(initial: Constraint[] = []) {
    this.constraints = [...initial];
  }

  /** 添加约束（去重：同 sourceCommentId + type + scope 视为重复） */
  add(constraint: Constraint): Constraint {
    const dup = this.constraints.find(
      (c) =>
        c.sourceCommentId === constraint.sourceCommentId &&
        c.type === constraint.type &&
        c.scope === constraint.scope
    );
    if (dup) {
      // 覆盖旧值，保留原 id 以维持可追溯性
      const idx = this.constraints.indexOf(dup);
      this.constraints[idx] = { ...dup, ...constraint, id: dup.id };
      return this.constraints[idx];
    }
    this.constraints.push(constraint);
    return constraint;
  }

  /** 批量添加 */
  addAll(constraints: Constraint[]): Constraint[] {
    return constraints.map((c) => this.add(c));
  }

  /** 移除某条评论产生的所有约束 */
  removeByCommentId(commentId: string): void {
    this.constraints = this.constraints.filter((c) => c.sourceCommentId !== commentId);
  }

  /** 移除某条约束 */
  remove(constraintId: string): void {
    this.constraints = this.constraints.filter((c) => c.id !== constraintId);
  }

  /** 获取全部约束 */
  getAll(): Constraint[] {
    return [...this.constraints];
  }

  /** 按类型过滤 */
  getByType(type: Constraint['type']): Constraint[] {
    return this.constraints.filter((c) => c.type === type);
  }

  /** 按优先级过滤 */
  getByPriority(priority: Constraint['priority']): Constraint[] {
    return this.constraints.filter((c) => c.priority === priority);
  }

  /** 按来源评论追溯 */
  getByCommentId(commentId: string): Constraint[] {
    return this.constraints.filter((c) => c.sourceCommentId === commentId);
  }

  /** 按作用范围过滤 */
  getByScope(scope: Constraint['scope']): Constraint[] {
    return this.constraints.filter((c) => c.scope === scope);
  }

  /** 清空 */
  clear(): void {
    this.constraints = [];
  }

  get size(): number {
    return this.constraints.length;
  }
}