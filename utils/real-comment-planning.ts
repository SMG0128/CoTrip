// 真实评论规划投影：只消费服务端验证并持久化的 AI analysis，绝不调用本地规则 Parser。

import { countSatisfiedConstraints, evaluateConstraintsAgainstPlan } from '../core/constraint-evaluator';
import { Comment } from '../types/comment';
import { Constraint } from '../types/constraint';
import { Plan } from '../types/plan';

export function constraintsFromServerComments(comments: Comment[]): Constraint[] {
  return comments.flatMap((comment) => {
    if (comment.aiStatus !== 'accepted' && comment.aiStatus !== 'conflict') return [];
    const drafts = comment.aiAnalysis?.constraints ?? [];
    return drafts.map((draft, index): Constraint => ({
      id: `constraint_${comment.id}_${index}`,
      tripId: comment.tripId,
      ownerId: comment.userId,
      sourceCommentId: comment.id,
      type: draft.type,
      scope: draft.scope,
      priority: draft.priority,
      value: { ...draft.value },
    }));
  });
}

export function evaluateRealCommentPlan(
  plan: Plan,
  comments: Comment[],
): { plan: Plan; constraints: Constraint[]; unresolvedCommentIds: string[] } {
  const constraints = constraintsFromServerComments(comments);
  const satisfiedConstraintCount = countSatisfiedConstraints(constraints, plan, plan.conflicts);
  // 主动执行完整评估，确保新增状态分支在真实链路中被覆盖；当前 UI 只展示汇总计数。
  evaluateConstraintsAgainstPlan(constraints, plan, plan.conflicts);
  return {
    plan: {
      ...plan,
      satisfiedConstraintCount,
      totalConstraintCount: constraints.length,
    },
    constraints,
    unresolvedCommentIds: comments
      .filter((comment) => comment.aiStatus !== 'accepted' && comment.aiStatus !== 'conflict')
      .map((comment) => comment.id),
  };
}
