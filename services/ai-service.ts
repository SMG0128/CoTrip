// services/ai-service.ts
// AI 服务接口：负责自然语言理解、Constraint 提取、Plan 生成。
// 当前仅提供 Mock 实现，不调用任何真实大模型。

import { Constraint } from '../types/constraint';
import { Plan } from '../types/plan';
import { Comment } from '../types/comment';

export interface ExtractConstraintsInput {
  tripId: string;
  comments: Comment[];
}

export interface GeneratePlanInput {
  tripId: string;
  constraints: Constraint[];
}

export interface AIService {
  extractConstraints(input: ExtractConstraintsInput): Promise<Constraint[]>;
  generatePlan(input: GeneratePlanInput): Promise<Plan>;
}