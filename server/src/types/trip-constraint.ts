// Server authoritative Constraint Ledger 实体。
// 每条约束必须可追溯：userId（作者）+ sourceCommentId（来源评论）。
// 禁止生成没有来源的神秘 constraint。
// status 语义：
//   ACTIVE     → 参与确定性评估
//   SUPERSEDED → 已被「已确认的替代」或「同一 source 评论的最新 analysis」替代
//                （保留历史，不删除）。注意：普通 supersession 候选在 V1 确认机制落地前
//                不会自动标记 SUPERSEDED——旧 HARD 约束保持 ACTIVE，直到成员明确确认。
//   WITHDRAWN  → 用户主动撤销（V1 预留）

export type TripConstraintType = 'AVAILABILITY' | 'LOCATION' | 'BUDGET' | 'PREFERENCE';
export type TripConstraintScope = 'TRIP' | 'SPORT' | 'DINING' | 'TRANSPORT';
export type TripConstraintPriority = 'HARD' | 'SOFT';
export type TripConstraintStatus = 'ACTIVE' | 'SUPERSEDED' | 'WITHDRAWN';

export interface TripConstraint {
  id: string;
  tripId: string;
  /** 来源评论 id；comment 已持久化后才允许写 Ledger */
  sourceCommentId: string;
  /** 约束作者（认证身份注入） */
  userId: string;
  type: TripConstraintType;
  scope: TripConstraintScope;
  priority: TripConstraintPriority;
  /** 规范化后的值：
   *  AVAILABILITY → { after?: string(HH:mm), until?: string(HH:mm) }
   *  BUDGET       → { min?: number, max?: number, currency?: string, unit?: string }
   *  LOCATION     → { city?: string, district?: string, poi?: string, locationId?: string }
   *  PREFERENCE   → { category?: string, tags?: string[] }
   */
  value: Record<string, unknown>;
  status: TripConstraintStatus;
  /** supersession：本约束替代的旧约束 id（保留历史，禁止删除旧约束） */
  supersedesConstraintId?: string;
  /** 潜在替代/冲突需要成员确认（例如替代旧 HARD 约束） */
  requiresConfirmation: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Comment AI 分析成功后，从 AICommentAnalysis.constraints 提取的待持久化约束 */
export interface ConstraintLedgerInput {
  sourceCommentId: string;
  userId: string;
  type: TripConstraintType;
  scope: TripConstraintScope;
  priority: TripConstraintPriority;
  value: Record<string, unknown>;
}
