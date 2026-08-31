// AI UI 配置的严格校验。
//
// 安全模型：AI 只能表达语义，绝不能表达样式。
//   - 白名单：只接受 changedEventIds / highlightEventIds / removedEventIds / message
//   - 黑名单：显式拦截 color / style / className 等样式字段并给出精确 reasonCode
//   - id 必须真实存在：changed/highlight 指向新计划，removed 指向旧计划且已不在新计划
//   - message 必须是纯文本：拒绝任何标记语言 / 控制字符 / 超长文本
// 任何违例一律拒绝整个 envelope，绝不「清洗后照用」。

import {
  AI_UI_MAX_ID_LENGTH,
  AI_UI_MAX_IDS_PER_FIELD,
  AI_UI_MAX_MESSAGE_LENGTH,
  AIUIConfig,
  emptyAIUIConfig,
} from '../types/ai-envelope';

export interface AIUIConfigValidationResult {
  ok: boolean;
  failurePath?: string;
  failureReasonCode?: string;
  ui?: AIUIConfig;
}

const ID_FIELDS = ['changedEventIds', 'highlightEventIds', 'removedEventIds'] as const;
const ALLOWED_KEYS: string[] = [...ID_FIELDS, 'message'];

/**
 * 显式样式黑名单：这些字段即便不在白名单里也会被拒，
 * 单独列出是为了给出精确的 AI_UI_FORBIDDEN_STYLE_FIELD 而不是笼统的未知字段。
 */
const FORBIDDEN_STYLE_KEYS = [
  'color',
  'background',
  'backgroundColor',
  'font',
  'fontSize',
  'fontWeight',
  'border',
  'borderRadius',
  'shadow',
  'padding',
  'margin',
  'className',
  'class',
  'style',
  'animation',
  'icon',
  'iconUrl',
  'image',
  'imageUrl',
  'theme',
];

/** 纯文本判定：标记语言起止符与 HTML 实体一律拒绝 */
const MARKUP_PATTERN = /[<>]|&[a-zA-Z#][a-zA-Z0-9]*;/;

const TAB = 9;
const LINE_FEED = 10;
const CARRIAGE_RETURN = 13;
const FIRST_PRINTABLE = 32;
const DELETE_CHAR = 127;

/**
 * 控制字符检测（保留 \t / \n / \r 三种常规空白）。
 * 刻意用字符码判断而非正则字面量：避免把真实控制字符写进源文件。
 */
function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === TAB || code === LINE_FEED || code === CARRIAGE_RETURN) continue;
    if (code < FIRST_PRINTABLE || code === DELETE_CHAR) return true;
  }
  return false;
}

function fail(path: string, reasonCode: string): AIUIConfigValidationResult {
  return { ok: false, failurePath: path, failureReasonCode: reasonCode };
}

export interface AIUIConfigValidationOptions {
  /**
   * 新计划中合法的 event id；提供时 changed/highlight 必须命中，
   * 未提供时跳过存在性校验。
   */
  newEventIds?: ReadonlySet<string>;
  /** 旧计划中的 event id；提供时 removed 必须命中且不得仍存在于新计划 */
  previousEventIds?: ReadonlySet<string>;
  /**
   * 是否允许 removedEventIds 非空。
   * INITIAL_GENERATION 没有「旧计划」，任何 removed 都是语义错误。
   */
  allowRemovals?: boolean;
}

function validateIdArray(
  value: unknown,
  field: string,
  options: AIUIConfigValidationOptions,
): { ok: true; ids: string[] } | AIUIConfigValidationResult {
  if (value === undefined) return { ok: true, ids: [] };
  if (!Array.isArray(value)) {
    return fail(`ui.${field}`, 'AI_UI_ID_ARRAY_REQUIRED');
  }
  if (value.length > AI_UI_MAX_IDS_PER_FIELD) {
    return fail(`ui.${field}`, 'AI_UI_TOO_MANY_IDS');
  }

  const seen = new Set<string>();
  const ids: string[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const id = value[i];
    if (typeof id !== 'string') {
      return fail(`ui.${field}[${i}]`, 'AI_UI_ID_NOT_STRING');
    }
    if (id.trim() === '') {
      return fail(`ui.${field}[${i}]`, 'AI_UI_ID_EMPTY');
    }
    if (id.length > AI_UI_MAX_ID_LENGTH) {
      return fail(`ui.${field}[${i}]`, 'AI_UI_ID_TOO_LONG');
    }
    if (seen.has(id)) continue; // 去重：重复 id 不是错误，直接收敛
    seen.add(id);
    ids.push(id);
  }

  if (field === 'removedEventIds') {
    if (ids.length > 0 && options.allowRemovals === false) {
      return fail(`ui.${field}`, 'AI_UI_REMOVAL_NOT_ALLOWED');
    }
    for (const id of ids) {
      // 被移除的条目必须来自旧计划
      if (options.previousEventIds && !options.previousEventIds.has(id)) {
        return fail(`ui.${field}`, 'AI_UI_UNKNOWN_EVENT_ID');
      }
      // 且必须真的已经不在新计划里，否则语义自相矛盾
      if (options.newEventIds && options.newEventIds.has(id)) {
        return fail(`ui.${field}`, 'AI_UI_REMOVED_EVENT_STILL_PRESENT');
      }
    }
    return { ok: true, ids };
  }

  if (options.newEventIds) {
    for (const id of ids) {
      if (!options.newEventIds.has(id)) {
        return fail(`ui.${field}`, 'AI_UI_UNKNOWN_EVENT_ID');
      }
    }
  }
  return { ok: true, ids };
}

/**
 * 校验并归一化 AI 的 ui 输出。
 * 缺省（undefined / null）视为「无 UI 提示」，归一化为安全空值；
 * 格式非法一律拒绝。
 */
export function validateAIUIConfig(
  value: unknown,
  options: AIUIConfigValidationOptions = {},
): AIUIConfigValidationResult {
  if (value === undefined || value === null) {
    return { ok: true, ui: emptyAIUIConfig() };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return fail('ui', 'AI_UI_OBJECT_REQUIRED');
  }

  const record = value as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    // 样式字段优先拦截：给出精确原因，明确「AI 不得控制视觉」
    if (FORBIDDEN_STYLE_KEYS.includes(key)) {
      return fail(`ui.${key}`, 'AI_UI_FORBIDDEN_STYLE_FIELD');
    }
    if (!ALLOWED_KEYS.includes(key)) {
      return fail(`ui.${key}`, 'AI_UI_UNKNOWN_FIELD');
    }
  }

  const ui = emptyAIUIConfig();
  for (const field of ID_FIELDS) {
    const result = validateIdArray(record[field], field, options);
    if (!('ids' in result)) return result;
    ui[field] = result.ids;
  }

  const message = record.message;
  if (message !== undefined && message !== null) {
    if (typeof message !== 'string') {
      return fail('ui.message', 'AI_UI_MESSAGE_NOT_STRING');
    }
    if (message.length > AI_UI_MAX_MESSAGE_LENGTH) {
      return fail('ui.message', 'AI_UI_MESSAGE_TOO_LONG');
    }
    if (MARKUP_PATTERN.test(message)) {
      return fail('ui.message', 'AI_UI_MESSAGE_MARKUP_FORBIDDEN');
    }
    if (hasControlCharacters(message)) {
      return fail('ui.message', 'AI_UI_MESSAGE_CONTROL_CHAR_FORBIDDEN');
    }
    const trimmed = message.trim();
    ui.message = trimmed === '' ? null : trimmed;
  }

  return { ok: true, ui };
}
