// Constraint Ledger 存储接口。
// 语义：
//   - 追加写入（绝不覆盖已有约束，保留可追溯历史）
//   - 状态变更（ACTIVE → SUPERSEDED）走 update，禁止删除
//   - 读取按 tripId 过滤；按 userId 过滤只用于同一用户约束比对（supersession），
//     绝不把"我的约束"当作行程级约束集合。

import { TripConstraint } from '../types/trip-constraint';

export interface ConstraintRepository {
  /** 追加一条约束；并发追加互不覆盖 */
  create(constraint: TripConstraint): Promise<TripConstraint>;
  /** 按 id 更新约束（仅允许 status/updatedAt 等受控字段变更） */
  update(constraint: TripConstraint): Promise<TripConstraint>;
  /** 读取某 Trip 的全部约束（按 createdAt 升序） */
  listByTrip(tripId: string): Promise<TripConstraint[]>;
}
