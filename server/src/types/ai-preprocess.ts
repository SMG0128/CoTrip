// AI Trip Pipeline V2 Envelope 类型（Server 权威定义）。
// 本阶段只实现 PREPROCESS；其余 requestType 仅为收敛统一 Envelope 预留，
// 不提前实现对应 pipeline。
// 核心不变量：PREPROCESS 只做意图/约束预处理，绝不产生 itinerary（trip 恒为 null）。

export type AIRequestType =
  | 'PREPROCESS'
  | 'COMMENT_EVALUATION'
  | 'INITIAL_GENERATION'
  | 'TRIP_UPDATE';

export const AI_ENVELOPE_SCHEMA_VERSION = '1.0';

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
export interface AITripPreprocessEnvelope {
  schemaVersion: string;
  requestType: 'PREPROCESS';
  status: 'success';
  analysis: AIPreprocessAnalysis;
  decision: AIPreprocessDecision;
  trip: null;
  ui?: Record<string, unknown>;
  meta?: Record<string, unknown>;
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
