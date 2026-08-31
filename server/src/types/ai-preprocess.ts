// AI Trip Pipeline V2 Envelope 类型（Server 权威定义）· PREPROCESS。
// 统一顶层 Envelope 契约见 types/ai-envelope.ts —— 四种 requestType 共享
// schemaVersion / requestType / status / analysis / decision / trip / ui / meta。
// 核心不变量：PREPROCESS 只做意图/约束预处理，绝不产生 itinerary（trip 恒为 null）。

import { AIEnvelopeBase, AIMeta, AIRequestType, AIUIConfig } from './ai-envelope';

// AIRequestType / schemaVersion 常量的权威定义已迁至 ai-envelope.ts；
// 此处再导出保持既有 import 路径可用，不另立第二套枚举。
export type { AIRequestType } from './ai-envelope';
export { AI_ENVELOPE_SCHEMA_VERSION } from './ai-envelope';

/** 创建行程原始信息：PREPROCESS 的 AI 输入（与创建请求一致的脱敏视图，无任何身份字段） */
export interface TripPreprocessTripInput {
  title: string;
  initialBrief: string;
  areaConstraint?: unknown;
  timeRange?: unknown;
}

export interface TripPreprocessAIInput {
  title: string;
  tripInput: TripPreprocessTripInput;
}

/** PREPROCESS 结构化分析：后续评论阶段可复用的上下文 */
export interface AIPreprocessAnalysis {
  title: string;
  intent: string;
  constraints: Record<string, unknown>;
  activities: string[];
  missingInformation: string[];
}

export interface AIPreprocessDecision {
  canGenerateTrip: boolean;
}

/** PREPROCESS 统一 Envelope：trip 恒为 null，禁止携带任何 itinerary */
export interface AITripPreprocessEnvelope extends AIEnvelopeBase {
  schemaVersion: string;
  requestType: 'PREPROCESS';
  status: 'success';
  analysis: AIPreprocessAnalysis;
  decision: AIPreprocessDecision;
  trip: null;
  ui?: AIUIConfig;
  meta?: AIMeta;
}

/** 持久化在 Trip 上的 AI Context：由验证通过的 PREPROCESS Envelope 落库 */
export interface TripAIContext {
  schemaVersion: string;
  requestType: AIRequestType;
  status: 'success';
  createdAt: string;
  analysis: AIPreprocessAnalysis;
  decision: AIPreprocessDecision;
  trip: null;
  tripInput: TripPreprocessTripInput;
}
