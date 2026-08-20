// server/src/repositories/user-repository.ts
// 用户仓库抽象。业务逻辑只依赖此接口，便于未来迁移到 SQLite/数据库。

import { User } from '../types/user';

export interface UserRepository {
  findByWechatOpenId(openid: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  create(user: User): Promise<User>;
  update(user: User): Promise<User>;
}