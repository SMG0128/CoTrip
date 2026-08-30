// Constraint Ledger Service：
//   PHASE 3 — 把已通过 schema+domain 校验的 AICommentAnalysis.constraints
//             转化为 TripConstraint 记录持久化（comment 必须先持久化）。
//   PHASE 4 — 保守 supersession：
//             同 user + 同 type + 同 scope 出现新约束时，旧约束标记 SUPERSEDED
//             （保留历史，禁止删除），新约束记录 supersedesConstraintId；
//             替代旧 HARD 约束时 requiresConfirmation=true。
// 绝不：AI 失败时伪造 constraint；AI 直接决定 satisfied。
//
// value 规范化：AI 契约（ai-comment.ts）字段名 → Ledger 统一格式。
//    AVAILABILITY  availableAfter/availableUntil(ISO datetime) → after/until(HH:mm, trip 时区)
//    LOCATION      city/district/locationId                     → 同字段
//    BUDGET        min/max/currency/unit                        → min/max
//    PREFERENCE    keyword/note                                 → category/tags
// 无法确定性规范化的 draft 直接跳过（不伪造约束）。

import {
  TripConstraint,
  TripConstraintType,
  TripConstraintScope,
  TripConstraintPriority,
} from '../types/trip-constraint';
import { ConstraintDraft } from '../types/ai-comment';
import { ConstraintRepository } from '../repositories/constraint-repository';

function generateConstraintId(now: Date): string {
  return `constraint_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 从 ISO datetime 提取 HH:mm（按 trip 时区）。解析失败返回 null。 */
export function extractTimeFromIso(iso: string, timezone = '+08:00'): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!match) return null;
  // V1 确定性规则：直接取 wall-clock HH:mm（trip 均以中国时区为主，夏令时不存在）。
  // 不尝试做绝对时间换算，避免引入时区猜测。
  return `${match[2]}:${match[3]}`;
}

/** AI draft value → Ledger 规范化 value。无法规范化返回 undefined。 */
export function normalizeConstraintValue(
  type: TripConstraintType,
  raw: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;

  switch (type) {
    case 'AVAILABILITY': {
      const value: Record<string, unknown> = {};
      if (typeof raw.availableAfter === 'string') {
        const after = extractTimeFromIso(raw.availableAfter);
        if (after) value.after = after;
      }
      if (typeof raw.availableUntil === 'string') {
        const until = extractTimeFromIso(raw.availableUntil);
        if (until) value.until = until;
      }
      return Object.keys(value).length > 0 ? value : undefined;
    }
    case 'LOCATION': {
      const value: Record<string, unknown> = {};
      if (typeof raw.city === 'string' && raw.city) value.city = raw.city;
      if (typeof raw.district === 'string' && raw.district) value.district = raw.district;
      if (typeof raw.locationId === 'string' && raw.locationId) value.locationId = raw.locationId;
      return Object.keys(value).length > 0 ? value : undefined;
    }
    case 'BUDGET': {
      const value: Record<string, unknown> = {};
      if (typeof raw.min === 'number' && Number.isFinite(raw.min)) value.min = raw.min;
      if (typeof raw.max === 'number' && Number.isFinite(raw.max)) value.max = raw.max;
      return Object.keys(value).length > 0 ? value : undefined;
    }
    case 'PREFERENCE': {
      const value: Record<string, unknown> = {};
      if (typeof raw.keyword === 'string' && raw.keyword) value.category = raw.keyword;
      if (typeof raw.note === 'string' && raw.note) value.note = raw.note;
      return Object.keys(value).length > 0 ? value : undefined;
    }
    default:
      return undefined;
  }
}

function sameSignature(a: TripConstraint, b: TripConstraint): boolean {
  return a.userId === b.userId && a.type === b.type && a.scope === b.scope;
}

export class ConstraintLedgerService {
  constructor(private readonly constraints: ConstraintRepository) {}

  /**
   * 评论 AI 分析成功后调用：把合法 constraints 写入 Ledger。
   * 幂等约定：同一 sourceCommentId 只允许持久化一次；重复调用时跳过（防重）。
   */
  async persistFromAnalysis(
    input: {
      tripId: string;
      commentId: string;
      userId: string;
      createdAt: string;
    },
    analysis: { constraints: ConstraintDraft[] },
  ): Promise<TripConstraint[]> {
    const existing = await this.constraints.listByTrip(input.tripId);
    // 防重：该评论若已持久化过，直接返回（AI 重试场景不产生重复约束）
    if (existing.some((constraint) => constraint.sourceCommentId === input.commentId)) {
      return existing.filter((constraint) => constraint.sourceCommentId === input.commentId);
    }

    const created: TripConstraint[] = [];
    for (const draft of analysis.constraints) {
      const now = new Date();
      const type = draft.type as TripConstraintType;
      const scope = draft.scope as TripConstraintScope;
      const priority = draft.priority as TripConstraintPriority;

      const value = normalizeConstraintValue(type, draft.value);
      if (!value) continue; // 无法确定性规范化 → 不伪造

      // 潜在替代候选：同 user+type+scope 的 ACTIVE 旧约束
      const superseded = existing.find(
        (constraint) =>
          constraint.status === 'ACTIVE'
          && sameSignature(constraint, {
            userId: input.userId,
            type,
            scope,
            priority,
          } as TripConstraint),
      );

      const constraint: TripConstraint = {
        id: generateConstraintId(now),
        tripId: input.tripId,
        sourceCommentId: input.commentId,
        userId: input.userId,
        type,
        scope,
        priority,
        value,
        status: 'ACTIVE',
        requiresConfirmation:
          Boolean(draft.priority === 'HARD' && superseded && superseded.priority === 'HARD'),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };

      if (superseded) {
        constraint.supersedesConstraintId = superseded.id;
        // 保守替代：旧约束不删除，标记 SUPERSEDED 保留历史
        await this.constraints.update({
          ...superseded,
          status: 'SUPERSEDED',
          updatedAt: now.toISOString(),
        });
      }

      created.push(await this.constraints.create(constraint));
    }
    return created;
  }
}
