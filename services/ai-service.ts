// services/ai-service.ts
// 本地 Demo AI 服务接口：负责规则 Constraint 提取与示例 Plan 生成。
// 真实评论 AI 接口位于 server，客户端绝不持有 Provider key。

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
