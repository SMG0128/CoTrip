// services/mock/mock-ai-service.ts
// AIService 的 Mock 实现：不调用任何真实大模型。

import { AIService, ExtractConstraintsInput, GeneratePlanInput } from '../ai-service';
import { Constraint } from '../../types/constraint';
import { Plan } from '../../types/plan';
import { mockPlan } from '../../mock/mock-plan';

export class MockAIService implements AIService {
  async extractConstraints(input: ExtractConstraintsInput): Promise<Constraint[]> {
    // Mock：根据评论数量生成占位约束
    return input.comments.map((c, i) => ({
      id: `constraint_${c.id}`,
      tripId: input.tripId,
      ownerId: c.userId,
      sourceCommentId: c.id,
      type: 'PREFERENCE',
      scope: 'TRIP',
      priority: 'SOFT',
      value: { note: `来自评论 ${i + 1}` },
    }));
  }

  async generatePlan(input: GeneratePlanInput): Promise<Plan> {
    // Mock：返回固定计划
    return {
      ...mockPlan,
      tripId: input.tripId,
      totalConstraintCount: input.constraints.length,
    };
  }
}