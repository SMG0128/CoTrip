// 评论：共享实体（Trip）下的独立记录，一条一档。
// userId 仅表示「评论作者」，绝不是评论流列表的读取范围——读取必须按 tripId。

export interface Comment {
  id: string;
  /** 归属的共享实体（行程/房间）：评论流的唯一读取范围 */
  tripId: string;
  /** 评论作者（由认证身份注入，客户端不可自报） */
  userId: string;
  /** 用户原始文本，必须保留（用于展示/重新解析/审计） */
  rawText: string;
  createdAt: string;
}
