// Coordinator AI 输入：Server 已验证后的结构化 coordination context。
// 隐私最小化：不传 openid、token、avatar URL 等账号数据；
// 参与者只传匿名 label / userId surrogate。

import { TripConstraint } from './trip-constraint';
import { TripConflict } from './trip-conflict';
import { TripCoordinationState } from './trip-coordination';

export interface CoordinationParticipant {
  /** userId surrogate（不暴露 openid） */
  id: string;
  /** 匿名标签（如 "成员A"），由 Server 生成 */
  label: string;
}

export interface TripCoordinationAIInput {
  tripId: string;
  participants: CoordinationParticipant[];
  /** Server authoritative constraints（ACTIVE） */
  constraints: TripConstraint[];
  /** Server deterministic evaluation（AI 不得重新计算或推翻） */
  deterministicEvaluation: TripCoordinationState;
  /** Server 已识别的 conflicts */
  conflicts: TripConflict[];
}
