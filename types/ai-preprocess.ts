// types/ai-preprocess.ts
// AI Trip Pipeline V2 Envelope 前端投影类型（与 server/src/types/ai-preprocess.ts 对应）。
// 前端本阶段不消费 aiContext 生成任何 itinerary；仅作为 API 响应结构声明。

export type AIRequestType =
  | 'PREPROCESS'
  | 'COMMENT_EVALUATION'
  | 'INITIAL_GENERATION'
  | 'TRIP_UPDATE';

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

/** PREPROCESS 统一 Envelope：trip 恒为 null */
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

/** 持久化在 Trip 上的 AI Context（Server 权威；创建时 PREPROCESS 产物） */
export interface TripAIContext {
  schemaVersion: string;
  requestType: AIRequestType;
  status: 'success';
  createdAt: string;
  analysis: AIPreprocessAnalysis;
  decision: AIPreprocessDecision;
  trip: null;
  tripInput: {
    title: string;
    initialBrief: string;
    areaConstraint?: unknown;
    timeRange?: unknown;
  };
}
