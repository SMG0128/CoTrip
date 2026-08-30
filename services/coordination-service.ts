// services/coordination-service.ts
// 行程协调服务契约（前端唯一边界）。
// 真实 Trip：Server Constraint Ledger + Server conflict evaluator + 真实 AI coordination service。
// 禁止前端本地重算协调状态。

import { TripCoordinationState, TripCoordinationProposal } from '../types/coordination';

export interface CoordinationResult {
  coordination: TripCoordinationState;
  proposal?: TripCoordinationProposal;
  coordinationUnavailable: boolean;
}

export interface CoordinationService {
  /** 读取协调状态：纯 deterministic，由 Server evaluator 生成 */
  getCoordination(tripId: string): Promise<CoordinationResult>;
  /** 请求 AI 协调建议：Server 自行加载 authoritative constraints 后调用 AI */
  analyze(tripId: string): Promise<CoordinationResult>;
}
