// services/mock/mock-ai-service.ts
// AIService 的本地规则实现：基于 core/ 规划引擎，不调用真实大模型。
// 注意：AIService 接口保持抽象，未来可替换为 LLMAIService。

import { AIService, ExtractConstraintsInput, GeneratePlanInput } from '../ai-service';
import { Constraint } from '../../types/constraint';
import { Plan } from '../../types/plan';
import { PlanningEngine } from '../../core/planning-engine';
import { mockPlan } from '../../mock/mock-plan';

export class LocalRuleBasedAIService implements AIService {
  async extractConstraints(input: ExtractConstraintsInput): Promise<Constraint[]> {
    const engine = new PlanningEngine({ tripId: input.tripId });
    const result = engine.processComments(input.comments);
    return result.constraints;
  }

  async generatePlan(input: GeneratePlanInput): Promise<Plan> {
    // 基于约束生成计划：若没有约束，回退到 Mock 计划
    if (input.constraints.length === 0) {
      return {
        ...mockPlan,
        tripId: input.tripId,
        totalConstraintCount: 0,
        satisfiedConstraintCount: 0,
      };
    }
    const engine = new PlanningEngine({
      tripId: input.tripId,
      initialPlan: mockPlan,
    });
    // 将约束直接注入存储，再协调计划
    engine.constraintStore.addAll(input.constraints);
    const result = engine.processComments([]);
    return result.plan;
  }
}

// 兼容旧引用：MockAIService 作为别名
export const MockAIService = LocalRuleBasedAIService;