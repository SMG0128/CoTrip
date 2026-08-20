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
    this.store.users.push(user);
    this.save();
    return user;
  }

  async update(user: User): Promise<User> {
    const idx = this.store.users.findIndex((u) => u.id === user.id);
    if (idx === -1) {
      throw new AppError(404, 'USER_PERSISTENCE_FAILURE', '用户不存在');
    }
    this.store.users[idx] = user;
    this.save();
    return user;
  }

  private load(): Store {
    try {
      if (!fs.existsSync(this.file)) {
        return { users: [] };
      }
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw) as Store;
      return { users: Array.isArray(parsed.users) ? parsed.users : [] };
    } catch {
      // 数据文件损坏时以空库启动，避免服务崩溃
      return { users: [] };
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.store, null, 2), 'utf8');
    } catch {
      throw new AppError(500, 'USER_PERSISTENCE_FAILURE', '用户数据保存失败');
    }
  }
}