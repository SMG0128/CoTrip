// Constraint Ledger Service：
//   PHASE 3 — 把已通过 schema+domain 校验的 AICommentAnalysis.constraints
//             转化为 TripConstraint 记录持久化（comment 必须先持久化）。
//   PHASE 4 — 保守 supersession（Production Readiness 修复）：
//             同 user + 同 type + 同 scope 出现新约束时，新约束记录
//             supersedesConstraintId；但旧 HARD 约束在成员明确确认前
//             保持 ACTIVE（不标记 SUPERSEDED），由 evaluator 保守交集。
//   REVIEW 5 — backfill：legacy comment.aiAnalysis（已持久化的权威 analysis）
//             懒式补写进 Ledger，幂等、不调 AI、不消耗 Token。
//   REVIEW 4 — source reconciliation：同一 comment 重新分析且内容变化时，
//             该 comment 的约束集合以最新 authoritative analysis 为准
//             （旧约束标记 SUPERSEDED 保留历史，数量不膨胀）。
// 绝不：AI 失败时伪造 constraint；AI 直接决定 satisfied。
//
// value 规范化：AI 契约（ai-comment.ts）字段名 → Ledger 统一格式。
//    AVAILABILITY  availableAfter/availableUntil(ISO datetime) → after/until(HH:mm, trip 时区)
//    LOCATION      city/district/locationId                     → 同字段
//    BUDGET        min/max/currency/unit                        → min/max/currency/unit
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
import { Comment } from '../types/comment';

function generateConstraintId(now: Date): string {
  return `constraint_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 从 ISO datetime 提取 HH:mm（按 trip 时区墙钟，默认 +08:00）。
 * Production Readiness（REVIEW 10）：
 *   - 带时区偏移（+08:00 / Z）→ 解析为绝对时刻后换算到目标时区墙钟，
 *     保证「不同 offset 但同一 instant」得到相同的 HH:mm。
 *   - 无时区偏移 → 视为已按 trip 时区给出的墙钟（AI 通常直接给本地时间）。
 * 解析失败返回 null。
 */
export function extractTimeFromIso(iso: string, timezone = '+08:00'): string | null {
  if (typeof iso !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso)) return null;

  const tzSuffix = /([+-]\d{2}:\d{2}|Z)$/.exec(iso);
  if (tzSuffix) {
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) return null;
    const tzMatch = /^([+-])(\d{2}):(\d{2})/.exec(timezone);
    const offsetMinutes = tzMatch
      ? (tzMatch[1] === '-' ? -1 : 1) * (Number(tzMatch[2]) * 60 + Number(tzMatch[3]))
      : 0;
    const wall = new Date(ms + offsetMinutes * 60 * 1000);
    const hours = String(wall.getUTCHours()).padStart(2, '0');
    const mins = String(wall.getUTCMinutes()).padStart(2, '0');
    return `${hours}:${mins}`;
  }

  const localMatch = /T(\d{2}):(\d{2})/.exec(iso);
  return localMatch ? `${localMatch[1]}:${localMatch[2]}` : null;
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
      // 保留 currency/unit：evaluator 只在单位兼容时求交集（REVIEW 11）
      if (typeof raw.currency === 'string' && raw.currency) value.currency = raw.currency;
      if (typeof raw.unit === 'string' && raw.unit) value.unit = raw.unit;
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

/** 同一 comment 的已持久化约束集合 vs 最新 analysis 规范化集合（忽略 status/时间戳） */
function sameConstraintSet(
  persisted: TripConstraint[],
  drafts: Array<{ type: TripConstraintType; scope: TripConstraintScope; priority: TripConstraintPriority; value: Record<string, unknown> }>,
): boolean {
  if (persisted.length !== drafts.length) return false;
  const key = (c: { type: string; scope: string; priority: string; value: Record<string, unknown> }) =>
    JSON.stringify([c.type, c.scope, c.priority, c.value]);
  const a = persisted.map(key).sort();
  const b = drafts.map(key).sort();
  return a.every((k, i) => k === b[i]);
}

interface NormalizedDraft {
  draft: ConstraintDraft;
  type: TripConstraintType;
  scope: TripConstraintScope;
  priority: TripConstraintPriority;
  value: Record<string, unknown>;
}

export class ConstraintLedgerService {
  constructor(private readonly constraints: ConstraintRepository) {}

  /**
   * 评论 AI 分析成功后调用：把合法 constraints 写入 Ledger。
   * 幂等约定：
   *   - 同一 sourceCommentId + 相同 analysis 集合 → no-op（返回已持久化约束）
   *   - 同一 sourceCommentId + analysis 内容变化 → source reconciliation：
   *     旧约束标记 SUPERSEDED（保留历史），写入最新集合（REVIEW 4）
   * 替代语义（REVIEW 1/2）：同 user+type+scope 的旧 ACTIVE 约束在新约束确认前
   * 保持 ACTIVE，不标记 SUPERSEDED；新约束记录 supersedesConstraintId +
   * requiresConfirmation（替代旧 HARD 时 true）。
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
    const existingForComment = existing.filter(
      (constraint) => constraint.sourceCommentId === input.commentId,
    );

    const drafts: NormalizedDraft[] = [];
    for (const draft of analysis.constraints) {
      const type = draft.type as TripConstraintType;
      const scope = draft.scope as TripConstraintScope;
      const priority = draft.priority as TripConstraintPriority;
      const value = normalizeConstraintValue(type, draft.value);
      if (!value) continue; // 无法确定性规范化 → 不伪造
      drafts.push({ draft, type, scope, priority, value });
    }

    // 该评论已持久化过约束：
    if (existingForComment.length > 0) {
      if (sameConstraintSet(existingForComment, drafts)) {
        // 幂等：内容一致，直接返回已持久化约束（重复处理不产生新约束）
        return existingForComment;
      }
      // source reconciliation：以最新 authoritative analysis 为准。
      // 旧约束标记 SUPERSEDED（保留历史，不删除），随后写入新集合。
      const reconcileNow = new Date();
      for (const old of existingForComment) {
        await this.constraints.update({
          ...old,
          status: 'SUPERSEDED',
          updatedAt: reconcileNow.toISOString(),
        });
      }
    }

    return this.createFromDrafts(input, drafts, existing);
  }

  private async createFromDrafts(
    input: { tripId: string; commentId: string; userId: string; createdAt: string },
    drafts: NormalizedDraft[],
    existing: TripConstraint[],
  ): Promise<TripConstraint[]> {
    const created: TripConstraint[] = [];
    for (const item of drafts) {
      const now = new Date();
      // 潜在替代候选：同 user+type+scope 的 ACTIVE 旧约束（来自其他评论）。
      // REVIEW 1/2：确认前旧约束保持 ACTIVE；新约束作为候选（supersedes + requiresConfirmation）。
      const superseded = existing.find(
        (constraint) =>
          constraint.status === 'ACTIVE'
          && constraint.sourceCommentId !== input.commentId
          && sameSignature(constraint, {
            userId: input.userId,
            type: item.type,
            scope: item.scope,
            priority: item.priority,
          } as TripConstraint),
      );

      const constraint: TripConstraint = {
        id: generateConstraintId(now),
        tripId: input.tripId,
        sourceCommentId: input.commentId,
        userId: input.userId,
        type: item.type,
        scope: item.scope,
        priority: item.priority,
        value: item.value,
        status: 'ACTIVE',
        // 替代旧 HARD 约束（无论新旧优先级）都需成员确认，防止被悄悄放宽
        requiresConfirmation: Boolean(superseded && superseded.priority === 'HARD'),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };

      if (superseded) {
        constraint.supersedesConstraintId = superseded.id;
        // 不 update 旧约束：旧 HARD 保持 ACTIVE 参与确定性交集（保守）
      }

      created.push(await this.constraints.create(constraint));
    }
    return created;
  }

  /**
   * Legacy Backfill（REVIEW 5/16）：把已持久化的权威 comment.aiAnalysis
   * 补写进 Ledger。条件：
   *   - aiStatus ∈ { accepted, waiting_confirm }（AI 分析已权威化）
   *   - aiAnalysis.constraints 非空
   *   - Ledger 尚无可追溯约束（幂等：重复运行 no-op）
   * 绝不：调用 AI、消耗 Token、修改 rawText、删除 comment。
   */
  async backfillFromComments(comments: Comment[]): Promise<number> {
    let materialized = 0;
    for (const comment of comments) {
      if (comment.aiStatus !== 'accepted' && comment.aiStatus !== 'waiting_confirm') continue;
      if (
        !comment.aiAnalysis
        || !Array.isArray(comment.aiAnalysis.constraints)
        || comment.aiAnalysis.constraints.length === 0
      ) {
        continue;
      }
      const existing = await this.constraints.listByTrip(comment.tripId);
      if (existing.some((constraint) => constraint.sourceCommentId === comment.id)) {
        continue; // 已 materialize：幂等跳过
      }
      const created = await this.persistFromAnalysis(
        {
          tripId: comment.tripId,
          commentId: comment.id,
          userId: comment.userId,
          createdAt: comment.createdAt,
        },
        comment.aiAnalysis,
      );
      materialized += created.length;
    }
    return materialized;
  }
}
