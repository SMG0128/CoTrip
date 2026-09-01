// place-candidate-ranker.ts
// 确定性候选排序（H 节）。
//
// 腾讯返回真实候选后，CoTrip 可排序。排序是确定性的、可解释的：
//   1. keyword / category 匹配度
//   2. 距离（近者优先）
//   3. 若 API 有真实 rating，则考虑 rating
//   4. 若 API 有真实 avgPrice 且用户有预算偏好，则考虑预算
//
// 候选必须全部来自腾讯 API response；本模块只排序，绝不创造候选。
// 不要求凑够 N 个：腾讯返回几个就排几个。

import { PlaceCandidate } from './tencent-lbs-service';

export interface RankingContext {
  /** 用户预算上限（人均，元）；缺省不参与排序 */
  budgetMaxPerPerson?: number;
  /** 是否偏好低价 */
  preferLowCost?: boolean;
}

export interface RankedPlaceCandidate extends PlaceCandidate {
  /** 结构化得分，越高越优先 */
  score: number;
  /** 是否超出预算偏好 */
  overBudget?: boolean;
  /** 排序理由（确定性文本，供 LLM 解释 / 前端展示） */
  reasons: string[];
}

/** 关键词匹配度：标题/分类包含关键词得高分 */
function keywordScore(candidate: PlaceCandidate, keyword: string): number {
  const kw = keyword.trim();
  if (!kw) return 0;
  let score = 0;
  if (candidate.name.includes(kw)) score += 3;
  if (candidate.category && candidate.category.includes(kw)) score += 2;
  if (candidate.address && candidate.address.includes(kw)) score += 1;
  return score;
}

/**
 * 对腾讯返回的候选做确定性排序。
 * 返回排序后的候选（含 score / reasons），不修改入参。
 */
export function rankPlaceCandidates(
  candidates: PlaceCandidate[],
  keyword: string,
  context: RankingContext = {},
): RankedPlaceCandidate[] {
  const ranked = candidates.map((candidate) => {
    const reasons: string[] = [];
    let score = 0;

    // 1. keyword / category 匹配度
    const kw = keywordScore(candidate, keyword);
    score += kw * 10;
    if (kw > 0) reasons.push(`关键词「${keyword}」匹配`);

    // 2. 距离（近者优先）：distanceMeters 越小分越高
    if (typeof candidate.distanceMeters === 'number') {
      const distanceScore = Math.max(0, 20 - candidate.distanceMeters / 200);
      score += distanceScore;
      reasons.push(`距离 ${candidate.distanceMeters} 米`);
    }

    // 3. 真实 rating（仅当 API 返回）
    if (typeof candidate.rating === 'number') {
      score += candidate.rating * 2;
      reasons.push(`评分 ${candidate.rating}`);
    }

    // 4. 真实 avgPrice + 预算偏好（仅当 API 返回且用户有预算偏好）
    let overBudget: boolean | undefined;
    if (typeof candidate.avgPrice === 'number') {
      if (context.preferLowCost) {
        score += Math.max(0, 10 - candidate.avgPrice / 20);
        reasons.push(`人均 ${candidate.avgPrice} 元`);
      }
      if (context.budgetMaxPerPerson !== undefined && candidate.avgPrice > context.budgetMaxPerPerson) {
        overBudget = true;
        reasons.push(`超出预算 ${context.budgetMaxPerPerson} 元`);
      }
    }

    return { ...candidate, score, overBudget, reasons };
  });

  // 确定性排序：score 降序；同分按距离升序；再同分按名称字典序（保证可复现）
  return ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const da = a.distanceMeters ?? Number.POSITIVE_INFINITY;
    const db = b.distanceMeters ?? Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
}