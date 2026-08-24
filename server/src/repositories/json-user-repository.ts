// server/src/repositories/json-user-repository.ts
// 基于本地 JSON 文件的用户仓库实现（开发期持久化）。
// 用户数据在重启后仍保留；通过 UserRepository 接口隔离，便于后续替换数据库。

import fs from 'fs';
import path from 'path';
import { UserRepository } from './user-repository';
import { User } from '../types/user';
import { AppError } from '../types/errors';

interface Store {
  users: User[];
}

export class JsonUserRepository implements UserRepository {
  private readonly file: string;
  private store: Store;

  constructor(file: string) {
    this.file = file;
    this.store = this.load();
  }

  async findByWechatOpenId(openid: string): Promise<User | null> {
    return this.store.users.find((u) => u.wechatOpenId === openid) ?? null;
  }

  async findById(id: string): Promise<User | null> {
    return this.store.users.find((u) => u.id === id) ?? null;
  }

  async create(user: User): Promise<User> {
    // 同一 openid 的并发首次登录必须汇合到同一个 CoTrip 用户。
    // create 在单进程内同步完成，因此第二个并发调用会看到第一个调用刚提交的 store。
    const existing = this.store.users.find((candidate) => candidate.wechatOpenId === user.wechatOpenId);
    if (existing) {
      return existing;
    }
    if (this.store.users.some((candidate) => candidate.id === user.id)) {
      throw new AppError(500, 'USER_PERSISTENCE_FAILURE', '用户数据保存失败');
    }

    const nextStore = { users: [...this.store.users, user] };
    this.save(nextStore);
    this.store = nextStore;
    return user;
  }

  async update(user: User): Promise<User> {
    const idx = this.store.users.findIndex((u) => u.id === user.id);
    if (idx === -1) {
      throw new AppError(404, 'USER_PERSISTENCE_FAILURE', '用户不存在');
    }
    const nextStore = {
      users: this.store.users.map((candidate, index) => (index === idx ? user : candidate)),
    };
    this.save(nextStore);
    this.store = nextStore;
    return user;
  }

  private load(): Store {
    try {
      if (!fs.existsSync(this.file)) {
        return { users: [] };
      }
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw) as { users?: unknown };
      if (!Array.isArray(parsed.users) || !parsed.users.every(isUser)) {
        throw new Error('invalid user store');
      }
      return { users: parsed.users };
    } catch {
      // 绝不把损坏文件当成空库，否则下一次登录会覆盖真实身份映射。
      throw new AppError(500, 'USER_PERSISTENCE_FAILURE', '用户数据读取失败');
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
        // 保留原始写入错误；清理临时文件失败不得泄露路径。
      }
      throw new AppError(500, 'USER_PERSISTENCE_FAILURE', '用户数据保存失败');
    }
  }
}

function isUser(value: unknown): value is User {
  if (!value || typeof value !== 'object') return false;
  const user = value as Record<string, unknown>;
  return (
    typeof user.id === 'string'
    && user.id.length > 0
    && typeof user.wechatOpenId === 'string'
    && user.wechatOpenId.length > 0
    && typeof user.nickname === 'string'
    && typeof user.avatarUrl === 'string'
    && typeof user.createdAt === 'number'
    && Number.isFinite(user.createdAt)
    && typeof user.updatedAt === 'number'
    && Number.isFinite(user.updatedAt)
  );
}
