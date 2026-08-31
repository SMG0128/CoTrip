// AI Trip Pipeline V2 · 统一 AI Envelope（Server 权威定义）。
//
// 四种 requestType 共享固定顶层结构，内部按 requestType 严格校验：
//   PREPROCESS          trip === null
//   COMMENT_EVALUATION  trip === null
//   INITIAL_GENERATION  trip !== null
//   TRIP_UPDATE         trip !== null（decision.tripChanged === true）
//
// ui 是 AI 唯一被允许影响界面的通道，且只能表达**语义**（哪个条目变了 / 值得高亮 /
// 被移除 / 一句状态消息）。「怎么显示」完全由前端代码决定 —— AI 绝不能输出颜色、
// 字体、组件样式、类名、图片或动画。校验层对此做白名单 + 黑名单双重拦截。

export type AIRequestType =
  | 'PREPROCESS'
  | 'COMMENT_EVALUATION'
  | 'INITIAL_GENERATION'
  | 'TRIP_UPDATE';

export const AI_ENVELOPE_SCHEMA_VERSION = '1.0';

/**
 * AI 可输出的 UI 语义配置（受控白名单，字段固定）。
 * id 一律指向 TripPlan.events[].id。
 */
export interface AIUIConfig {
  /** 本次发生实质变化的条目（新计划中存在） */
  changedEventIds: string[];
  /** 值得引起注意的条目（新计划中存在） */
  highlightEventIds: string[];
  /** 被移除的条目（旧计划中存在、新计划中已不存在） */
  removedEventIds: string[];
  /** 一句纯文本状态消息；禁止 HTML / 富文本 / 脚本 */
  message: string | null;
}

/** Provider 侧自由元数据；仅用于调试判断，绝不持久化（避免存储 AI 原始响应） */
export type AIMeta = Record<string, unknown>;

/** 安全空值：PREPROCESS / COMMENT_EVALUATION 恒为此值；AI 缺省 ui 时归一化为此值 */
export const EMPTY_AI_UI_CONFIG: AIUIConfig = {
  changedEventIds: [],
  highlightEventIds: [],
  removedEventIds: [],
  message: null,
};

export function emptyAIUIConfig(): AIUIConfig {
  return {
    changedEventIds: [],
    highlightEventIds: [],
    removedEventIds: [],
    message: null,
  };
}

/**
 * 统一顶层 Envelope。
 *
 * ui / meta 在线上允许缺省（视为「无 UI 提示」）——缺省不是语义违例，
 * 但**格式非法**是违例，必须拒绝。校验层统一归一化，因此校验通过之后
 * 业务代码拿到的永远是完整 AIUIConfig。
 */
export interface AIEnvelopeBase {
  schemaVersion: string;
  requestType: AIRequestType;
  status: 'success';
  analysis: unknown;
  decision: unknown;
  trip: unknown;
  ui?: AIUIConfig;
  meta?: AIMeta;
}

/** 校验结果统一形状；ok 时附带归一化后的 ui */
export interface AIEnvelopeValidationResult {
  ok: boolean;
  failurePath?: string;
  failureReasonCode?: string;
  /** 校验通过时的归一化 UI 配置（AI 缺省时为安全空值） */
  ui?: AIUIConfig;
}

/**
 * 持久化在 Trip 上的最新一次 AI UI 提示。
 *
 * 刻意放在 trip 层而不是塞进 currentPlan：presentation metadata 有独立生命周期，
 * 不应污染行程核心事实。planVersion 用于让前端判断提示是否仍对应当前计划版本；
 * 每次新版本落库时整体替换，不保存历史、不保存 AI 原始响应。
 */
export interface TripLatestAIUI {
  /** 产生本提示的 currentPlan.version；与当前版本不符时前端必须忽略 */
  planVersion: number;
  requestType: Extract<AIRequestType, 'INITIAL_GENERATION' | 'TRIP_UPDATE'>;
  ui: AIUIConfig;
  updatedAt: string;
}

// —— ui 字段边界 ——
export const AI_UI_MAX_IDS_PER_FIELD = 50;
export const AI_UI_MAX_ID_LENGTH = 64;
export const AI_UI_MAX_MESSAGE_LENGTH = 200;
