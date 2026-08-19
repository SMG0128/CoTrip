// core/candidate-ranker.ts
// 候选排序器：根据约束对真实餐厅候选进行排序。
// 这是 Planner Ranking 逻辑，禁止在 UI 中写死 if (restaurant.name === '大头虾')。

import { Constraint } from '../types/constraint';
import { Restaurant } from '../types/restaurant';

export interface RankedCandidate {
  restaurant: Restaurant;
  /** 排序得分（越高越优先） */
  score: number;
  /** 是否超出预算偏好 */
  overBudget: boolean;
  /** 命中约束数 */
  matchedConstraintCount: number;
  /** 排序理由 */
  reasons: string[];
}

export interface RankCandidatesInput {
  restaurants: Restaurant[];
  constraints: Constraint[];
  /** 预算上限（来自 BUDGET 约束） */
  budgetMax?: number;
  /** 期望区域（来自 LOCATION 约束） */
  district?: string;
}

/**
 * 对餐厅候选排序。
 * 规则：
 *  - 命中区域约束 +分
 *  - 命中预算约束（价格 <= max）+分
 *  - 超预算标记 overBudget，但不排除（作为备选）
 *  - 价格越低越优先（在预算内）
 */
export function rankCandidates(input: RankCandidatesInput): RankedCandidate[] {
  const { restaurants, constraints } = input;

  // 从约束推导预算上限与区域
  const budgetMax =
    input.budgetMax ??
    constraints.find(
      (c) => c.type === 'BUDGET' && typeof c.value.max === 'number'
    )?.value.max as number | undefined;

  const district =
    input.district ??
    constraints.find(
      (c) => c.type === 'LOCATION' && typeof c.value.district === 'string'
    )?.value.district as string | undefined;

  const ranked = restaurants.map((r) => {
    const reasons: string[] = [];
    let score = 0;
    const price = r.averagePrice?.amount;

    // 区域匹配
    if (district && r.location.district === district) {
      score += 3;
      reasons.push(`位于${district}`);
    }

    // 预算匹配
    let overBudget = false;
    if (budgetMax !== undefined && price !== undefined) {
      if (price <= budgetMax) {
        score += 3;
        reasons.push(`人均 ¥${price} 在预算 ¥${budgetMax} 内`);
      } else {
        overBudget = true;
        reasons.push(`人均 ¥${price} 超出预算 ¥${budgetMax}`);
      }
    }

    // 价格越低越优先（预算内）
    if (price !== undefined && !overBudget) {
      score += Math.max(0, 10 - price / 10);
    }

    // 评分加成
    if (r.rating?.score) {
      score += r.rating.score / 10;
    }

    return {
      restaurant: r,
      score,
      overBudget,
      matchedConstraintCount: reasons.length,
      reasons,
    };
  });

  // 排序：overBudget 的排后面，其余按 score 降序
  return ranked.sort((a, b) => {
    if (a.overBudget !== b.overBudget) return a.overBudget ? 1 : -1;
    return b.score - a.score;
  });
}