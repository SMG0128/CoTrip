// utils/comment-sync.ts
// 评论流同步纯函数：乐观更新 + 服务端确认合并。
// 原则：服务端返回为最终真相；按 comment.id 去重，绝不按数组位置或内容去重。

import { Comment } from '../types/comment';

export const TEMP_COMMENT_PREFIX = 'temp_comment_';

export function isTempCommentId(id: string): boolean {
  return id.startsWith(TEMP_COMMENT_PREFIX);
}

export function createTempCommentId(): string {
  return `${TEMP_COMMENT_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 用服务端确认的评论替换本地第一个尚未确认的乐观项；
 * 无待确认项时按 id 去重追加。结果按 createdAt 升序稳定排序。
 */
export function commitServerComment(local: Comment[], server: Comment): Comment[] {
  const pendingIndex = local.findIndex((c) => isTempCommentId(c.id));
  const merged =
    pendingIndex === -1
      ? local.some((c) => c.id === server.id)
        ? local
        : [...local, server]
      : local.map((c, i) => (i === pendingIndex ? server : c));
  return [...merged].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * 以服务端列表为准合并评论流：按 id 去重、服务端覆盖本地同 id 项、按 createdAt 升序。
 * 本地未确认的乐观项（temp_ 前缀）：若服务端已存在同 (userId, rawText) 的确认项，
 * 视为同一条评论的乐观/确认版本，丢弃 temp，避免同内容重复显示。
 */
export function mergeServerComments(local: Comment[], server: Comment[]): Comment[] {
  const serverIds = new Set(server.map((c) => c.id));
  const tempDropped = new Set<string>();
  for (const comment of local) {
    if (isTempCommentId(comment.id) && !serverIds.has(comment.id)) {
      const confirmed = server.find(
        (s) => s.userId === comment.userId && s.rawText === comment.rawText
      );
      if (confirmed) tempDropped.add(comment.id);
    }
  }
  const byId = new Map<string, Comment>();
  for (const comment of local) {
    if (!tempDropped.has(comment.id)) byId.set(comment.id, comment);
  }
  for (const comment of server) byId.set(comment.id, comment);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
