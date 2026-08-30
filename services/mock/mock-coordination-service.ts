// services/mock/mock-coordination-service.ts
// 示例行程（Demo Trip）专用协调 Mock：纯确定性 mock data。
// 与真实行程严格隔离：真实 Trip 禁止引用本服务（见 services/index.ts 接线与页面门禁）。

import { CoordinationResult, CoordinationService } from '../coordination-service';

export class MockCoordinationService implements CoordinationService {
  async getCoordination(_tripId: string): Promise<CoordinationResult> {
    return this.buildDemoResult();
  }

  async analyze(_tripId: string): Promise<CoordinationResult> {
    return this.buildDemoResult();
  }

  private buildDemoResult(): CoordinationResult {
    return {
      coordination: {
        tripId: 'demo-local-trip',
        activeConstraintCount: 2,
        hardConstraintCount: 1,
        softConstraintCount: 1,
        participantCount: 2,
        commonAvailability: { after: '16:00', until: '17:00' },
        commonBudget: { min: 80, max: 80 },
        hardConflicts: [],
        softTensions: [
          {
            id: 'demo_tension_pref',
            tripId: 'demo-local-trip',
            kind: 'SOFT_TENSION',
            dimension: 'PREFERENCE',
            constraintIds: ['demo_c_pref_vn', 'demo_c_pref_jp'],
            participantUserIds: ['demo_u_a', 'demo_u_b'],
            reasonCode: 'PREFERENCE_DIVERGENCE',
            status: 'OPEN',
            createdAt: '2026-08-30T00:00:00.000Z',
            updatedAt: '2026-08-30T00:00:00.000Z',
          },
        ],
        supersessionCandidates: [],
        requiresConfirmation: false,
        updatedAt: '2026-08-30T00:00:00.000Z',
      },
      proposal: {
        summary: '两位成员的共同可用时间是 16:00-17:00。饮食偏好不同，可以优先寻找同时提供越南菜和日式选择的商场/餐饮区域。',
        status: 'READY',
        suggestions: [
          {
            kind: 'PRIORITIZE_PROXIMITY',
            affectedConstraintIds: ['demo_c_pref_vn', 'demo_c_pref_jp'],
            message: '建议优先选择交通时间短、可同时满足两种饮食偏好的地点。',
            requiresConfirmation: false,
            confidence: 0.7,
          },
        ],
      },
      coordinationUnavailable: false,
    };
  }
}
