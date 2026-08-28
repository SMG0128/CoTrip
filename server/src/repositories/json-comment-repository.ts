// JSON 评论仓库：独立记录 + 原子追加写入，服务重启后评论流仍在。
// create 使用同步 read-modify-write + 原子 rename：
// 在 Node 单线程下，并发 create 的同步段天然串行执行，每条评论独立追加，
// 绝不出现「后写覆盖先写」的 last-write-wins 丢评论问题。

import fs from 'fs';
import path from 'path';
import { Comment } from '../types/comment';
import { CommentRepository } from './comment-repository';
import { AppError } from '../types/errors';

interface Store {
  comments: Comment[];
}

export class JsonCommentRepository implements CommentRepository {
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  create(comment: Comment): Promise<Comment> {
    // 同步 read-modify-write：同一事件循环内串行执行，追加互不覆盖
    const current = this.load();
    const nextStore: Store = { comments: [...current.comments, comment] };
    this.save(nextStore);
    return Promise.resolve(comment);
  }

  update(comment: Comment): Promise<Comment> {
    const current = this.load();
    if (!current.comments.some((candidate) => candidate.id === comment.id)) {
      throw new AppError(404, 'COMMENT_NOT_FOUND', '评论不存在');
    }
    const nextStore: Store = {
      comments: current.comments.map((candidate) =>
        candidate.id === comment.id ? comment : candidate
      ),
    };
    this.save(nextStore);
    return Promise.resolve(comment);
  }

  listByTrip(tripId: string): Promise<Comment[]> {
    const list = this.load().comments
      .filter((comment) => comment.tripId === tripId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return Promise.resolve(list);
  }

  private load(): Store {
    if (!fs.existsSync(this.file)) {
      return { comments: [] };
    }
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw) as { comments?: unknown };
      if (!Array.isArray(parsed.comments)) {
        throw new Error('invalid comment store');
      }
      return { comments: (parsed.comments as Partial<Comment>[]).map(normalizeComment) };
    } catch {
      throw new AppError(500, 'COMMENT_PERSISTENCE_FAILURE', '评论数据读取失败');
    }
  }

  private save(store: Store): void {
    const directory = path.dirname(this.file);
    const temporaryFile = `${this.file}.tmp`;
    try {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(temporaryFile, JSON.stringify(store, null, 2), 'utf8');
      fs.renameSync(temporaryFile, this.file);
    } catch {
      try {
        fs.rmSync(temporaryFile, { force: true });
      } catch {
        // 保留原始写入错误
      }
      throw new AppError(500, 'COMMENT_PERSISTENCE_FAILURE', '评论数据保存失败');
    }
  }
}

function normalizeComment(comment: Partial<Comment>): Comment {
  const validStatuses: Comment['aiStatus'][] = [
    'processing',
    'accepted',
    'conflict',
    'unresolved',
    'waiting_confirm',
  ];
  const validSources: Comment['aiSource'][] = ['provider', 'rule_fallback', 'none'];
  return {
    id: String(comment.id ?? ''),
    tripId: String(comment.tripId ?? ''),
    userId: String(comment.userId ?? ''),
    rawText: String(comment.rawText ?? ''),
    createdAt: String(comment.createdAt ?? ''),
    aiStatus: validStatuses.includes(comment.aiStatus as Comment['aiStatus'])
      ? comment.aiStatus as Comment['aiStatus']
      : 'unresolved',
    aiSource: validSources.includes(comment.aiSource as Comment['aiSource'])
      ? comment.aiSource as Comment['aiSource']
      : 'none',
    ...(comment.aiAnalysis ? { aiAnalysis: comment.aiAnalysis } : {}),
  };
}
