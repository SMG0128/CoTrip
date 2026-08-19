// core/constraint-parser.ts
// 规则解析器：将自然语言评论解析为结构化 Constraint。
// 注意：这是"规则 Parser"，不是最终 AI。AIService 接口保持抽象，
// 未来可替换为 LLMAIService，Parser 只是当前本地实现。

import { Comment } from '../types/comment';
import {
  Constraint,
  ConstraintScope,
  ConstraintPriority,
  ConstraintType,
} from '../types/constraint';
import { TimeRange } from '../types/time';

export interface ParseContext {
  tripId: string;
  /** 行程日期（ISO 8601 日期部分），用于把"11点半"解析为完整时间戳 */
  tripDate?: string;
  /** 行程时区，默认 Asia/Shanghai */
  timezone?: string;
}

export interface ParseResult {
  constraints: Constraint[];
  /** 无法解析的评论 id */
  unresolvedCommentIds: string[];
}

/** 生成稳定 id */
function makeId(prefix: string, commentId: string, index: number): string {
  return `${prefix}_${commentId}_${index}`;
}

/** 从评论文本中提取数字（支持中文数字与阿拉伯数字） */
function extractNumber(text: string): number | undefined {
  const cnMap: Record<string, number> = {
    零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
    六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  };
  // 阿拉伯数字
  const arabic = text.match(/(\d+(?:\.\d+)?)/);
  if (arabic) return parseFloat(arabic[1]);
  // 中文数字（仅支持 0-99 简单场景）
  const cnMatch = text.match(/[零一二两三四五六七八九十]+/);
  if (cnMatch) {
    const s = cnMatch[0];
    if (s === '十') return 10;
    if (s.includes('十')) {
      const parts = s.split('十');
      const tens = parts[0] ? cnMap[parts[0]] : 1;
      const ones = parts[1] ? cnMap[parts[1]] : 0;
      return tens * 10 + ones;
    }
    return cnMap[s];
  }
  return undefined;
}

/** 从文本中提取 HH:MM 或 "X点Y分" / "X点半" 形式的时间 */
function extractClockTime(text: string): { hour: number; minute: number } | undefined {
  // HH:MM
  const hhmm = text.match(/(\d{1,2})[:：](\d{1,2})/);
  if (hhmm) {
    const h = parseInt(hhmm[1], 10);
    const m = parseInt(hhmm[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return { hour: h, minute: m };
  }
  // X点Y分 / X点半（支持 上午/下午/晚上 前缀）
  const cn = text.match(/(上午|下午|晚上|中午)?\s*(\d{1,2}|[零一二两三四五六七八九十]+)\s*点(?:\s*(\d{1,2}|[零一二两三四五六七八九十]+)\s*分?)?/);
  if (cn) {
    const period = cn[1];
    const hourStr = cn[2];
    let hour = /^\d+$/.test(hourStr) ? parseInt(hourStr, 10) : extractNumber(hourStr);
    if (hour === undefined) return undefined;
    // 下午/晚上 12 小时制转 24 小时制
    if (period === '下午' || period === '晚上') {
      if (hour < 12) hour += 12;
    } else if (period === '中午' && hour < 12) {
      hour += 12;
    }
    let minute = 0;
    if (cn[3]) {
      const mStr = cn[3];
      minute = /^\d+$/.test(mStr) ? parseInt(mStr, 10) : (extractNumber(mStr) ?? 0);
    } else if (text.includes('半')) {
      minute = 30;
    }
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }
  return undefined;
}

/** 将时钟时间与行程日期组合为 ISO 8601 时间戳 */
function toIso(tripDate: string | undefined, timezone: string, clock: { hour: number; minute: number }): string {
  const date = tripDate || '2026-08-22';
  const offset = timezone === 'Asia/Shanghai' ? '+08:00' : '+08:00';
  const hh = String(clock.hour).padStart(2, '0');
  const mm = String(clock.minute).padStart(2, '0');
  return `${date}T${hh}:${mm}:00${offset}`;
}

/** 判断文本是否包含某个关键词 */
function has(text: string, keywords: string[]): boolean {
  return keywords.some((k) => text.includes(k));
}

/** 判断文本是否表达"必须/只能/不要超过"等强约束语气 */
function isHard(text: string): boolean {
  // "最好" 是软约束语气，即使同时出现"不要超过"也应视为 SOFT
  if (has(text, ['最好', '希望', '尽量'])) return false;
  return has(text, ['必须', '只能', '一定要', '不要超过', '不能超过', '不超过', '得走', '就要', '只', '必须得']);
}

/** 判断文本是否表达"最好/希望/想/尽量"等软约束语气 */
function isSoft(text: string): boolean {
  return has(text, ['最好', '希望', '想', '尽量', '可以', '比较', '有点', '便宜点', '别太']);
}

/** 判断文本是否涉及"吃/餐厅/菜"等餐饮范围 */
function isDining(text: string): boolean {
  return has(text, ['吃', '餐厅', '菜', '饭', '餐']);
}

/** 判断文本是否涉及"打/球/运动"等运动范围 */
function isSport(text: string): boolean {
  return has(text, ['打', '球', '运动', '羽毛球', '篮球', '健身']);
}

/** 判断文本是否涉及"坐/地铁/交通/走"等交通范围 */
function isTransport(text: string): boolean {
  return has(text, ['地铁', '公交', '打车', '交通', '坐', '走', '开车']);
}

/**
 * 解析单条评论为约束列表。
 * 返回空数组表示该评论无法解析出任何约束。
 */
export function parseComment(comment: Comment, ctx: ParseContext): Constraint[] {
  const text = comment.rawText;
  const tripId = ctx.tripId;
  const timezone = ctx.timezone || 'Asia/Shanghai';
  const tripDate = ctx.tripDate;
  const constraints: Constraint[] = [];
  let index = 0;

  const push = (
    type: ConstraintType,
    scope: ConstraintScope,
    priority: ConstraintPriority,
    value: Record<string, unknown>
  ) => {
    constraints.push({
      id: makeId('constraint', comment.id, index++),
      tripId,
      ownerId: comment.userId,
      sourceCommentId: comment.id,
      type,
      scope,
      priority,
      value,
    });
  };

  // ---- 1. AVAILABILITY：可用时间 / 截止时间 ----
  // "我11点半才有空" / "我下午五点前得走"
  // 时钟模式：HH:MM / 11点半 / 下午五点 / 五点
  const clockPattern = '((?:上午|下午|晚上|中午)?\\s*(?:\\d{1,2}[:：]\\d{1,2}|\\d{1,2}\\s*点(?:\\s*半|\\s*\\d{1,2}\\s*分?)?|[零一二两三四五六七八九十]+\\s*点(?:\\s*半|\\s*[零一二两三四五六七八九十]+\\s*分?)?))';
  const afterMatch = text.match(new RegExp(`(?:才|就|之后|以后|开始)?\\s*${clockPattern}\\s*(?:才|就)?\\s*(?:有|才|开始)?\\s*(?:空|时间|有空|开始)`));
  const untilMatch = text.match(new RegExp(`(?:${clockPattern})\\s*(?:前|之前|以前)?\\s*(?:得走|走|离开|结束|必须走|要走了)`));

  if (afterMatch && has(text, ['有空', '才有空', '以后才有空', '之后才有空', '才有时间', '开始'])) {
    const clock = extractClockTime(afterMatch[1]);
    if (clock) {
      push('AVAILABILITY', 'TRIP', 'HARD', {
        availableAfter: toIso(tripDate, timezone, clock),
      });
    }
  } else if (untilMatch) {
    const clock = extractClockTime(untilMatch[1]);
    if (clock) {
      push('AVAILABILITY', 'TRIP', 'HARD', {
        availableUntil: toIso(tripDate, timezone, clock),
      });
    }
  }

  // ---- 2. LOCATION：区域 / 地点 ----
  // "羽毛球必须在天河" / "最好在越秀吃"
  const districtMatch = text.match(/(?:在|去|到)\s*([\u4e00-\u9fa5]{2,4}区?)/);
  if (districtMatch) {
    const district = districtMatch[1].replace(/区$/, '') + '区';
    const scope: ConstraintScope = isDining(text) ? 'DINING' : isSport(text) ? 'SPORT' : 'TRIP';
    const priority: ConstraintPriority = isHard(text) ? 'HARD' : 'SOFT';
    push('LOCATION', scope, priority, { district });
  }

  // ---- 3. BUDGET：预算 ----
  // "人均不要超过80" / "最好人均80以内" / "最近没钱，便宜点"
  const budgetMatch = text.match(/(?:人均|每人|总预算|预算|人均消费)\s*(?:最好|希望|尽量)?\s*(?:不要超过|不能超过|不超过|控制在|在|以内|以内不超过|≤|<=|少于|低于)?\s*(\d+(?:\.\d+)?)/);
  if (budgetMatch) {
    const max = parseFloat(budgetMatch[1]);
    const unit = has(text, ['人均', '每人']) ? 'PER_PERSON' : 'TOTAL';
    const priority: ConstraintPriority = isHard(text) ? 'HARD' : 'SOFT';
    push('BUDGET', 'TRIP', priority, { max, currency: 'CNY', unit });
  } else if (has(text, ['没钱', '便宜', '省钱', '穷', '预算有限'])) {
    push('BUDGET', 'TRIP', 'SOFT', { preference: 'LOW_COST', currency: 'CNY', unit: 'PER_PERSON' });
  }

  // ---- 4. PREFERENCE：偏好 ----
  // "想吃越南菜" / "最好坐地铁" / "不想走太远"
  if (has(text, ['越南菜', '越南', 'pho', 'phở'])) {
    push('PREFERENCE', 'DINING', isHard(text) ? 'HARD' : 'SOFT', { keyword: 'VIETNAMESE', note: '越南菜' });
  }
  if (has(text, ['地铁'])) {
    push('PREFERENCE', 'TRANSPORT', isSoft(text) ? 'SOFT' : 'HARD', { keyword: 'METRO', note: '坐地铁' });
  }
  if (has(text, ['不想走太远', '别太远', '近一点', '不要太远'])) {
    push('PREFERENCE', 'TRANSPORT', 'SOFT', { keyword: 'NEARBY', note: '不想走太远' });
  }

  return constraints;
}

/**
 * 批量解析评论。
 * 返回所有约束 + 无法解析的评论 id。
 */
export function parseComments(comments: Comment[], ctx: ParseContext): ParseResult {
  const constraints: Constraint[] = [];
  const unresolvedCommentIds: string[] = [];

  for (const comment of comments) {
    const parsed = parseComment(comment, ctx);
    if (parsed.length === 0) {
      unresolvedCommentIds.push(comment.id);
    } else {
      constraints.push(...parsed);
    }
  }

  return { constraints, unresolvedCommentIds };
}

/** 供测试/调试使用的默认解析上下文 */
export function defaultParseContext(tripId: string, tripDate?: string): ParseContext {
  return { tripId, tripDate, timezone: 'Asia/Shanghai' };
}