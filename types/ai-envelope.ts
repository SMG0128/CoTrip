// types/ai-envelope.ts
// AI Trip Pipeline V2 统一 Envelope 的前端镜像类型。
// 权威定义在 server/src/types/ai-envelope.ts —— 本文件必须与其保持一致，
// 任何字段增删都要两端同步（tests/ai-ui-config.test.ts 对字段集合做守卫）。
//
// 核心安全约定：AI 只能表达**语义**（哪个条目变了 / 值得高亮 / 被移除 / 一句状态消息）。
// 颜色、字体、组件样式、类名、图片、动画一律由前端代码决定，AI 无权干预。
// 前端也绝不能自行根据评论文本推断 relevant / usable / updateRequired ——
// 这些判断只能来自服务端 pipeline。

export type AIRequestType =
  | 'PREPROCESS'
  | 'COMMENT_EVALUATION'
  | 'INITIAL_GENERATION'
  | 'TRIP_UPDATE';

/** AI 可输出的 UI 语义配置；id 一律指向 Plan.events[].id */
export interface AIUIConfig {
  changedEventIds: string[];
  highlightEventIds: string[];
  removedEventIds: string[];
  /** 纯文本状态消息；服务端已拒绝任何 HTML / 富文本 / 控制字符 */
  message: string | null;
}

/** 服务端随新计划版本一起下发的最新 UI 提示 */
export interface TripLatestAIUI {
  /** 产生本提示的 currentPlan.version；与当前版本不符时必须忽略 */
  planVersion: number;
  requestType: 'INITIAL_GENERATION' | 'TRIP_UPDATE';
  ui: AIUIConfig;
  updatedAt: string;
}

export function emptyAIUIConfig(): AIUIConfig {
  return {
    changedEventIds: [],
    highlightEventIds: [],
    removedEventIds: [],
    message: null,
  };
}
