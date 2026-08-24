// server/src/services/auth-service.ts
// 认证业务逻辑：登录（code2Session → 查找/创建用户 → 签发 token）、资料读取与更新。

import crypto from 'crypto';
import { UserRepository } from '../repositories/user-repository';
import { WechatService } from './wechat-service';
import { TokenService } from './token-service';
import {
  DEFAULT_USER_NICKNAME,
  User,
  PublicUser,
  isRealNickname,
  toPublicUser,
} from '../types/user';
import { AppError } from '../types/errors';

export interface LoginResult {
  token: string;
  user: PublicUser;
}

export interface AuthService {
  login(code: string): Promise<LoginResult>;
  getProfile(userId: string): Promise<PublicUser>;
  updateProfile(userId: string, patch: { nickname?: string; avatarUrl?: string }): Promise<PublicUser>;
}

export class RealAuthService implements AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly wechat: WechatService,
    private readonly tokens: TokenService,
  ) {}

  async login(code: string): Promise<LoginResult> {
    if (!code || typeof code !== 'string' || code.length === 0) {
      throw new AppError(400, 'AUTH_MISSING_CODE', '缺少登录凭证 code');
    }

    // 1. 微信 code2Session 换取 openid
    const { openid } = await this.wechat.code2Session(code);

    // 2. 按 openid 查找用户，不存在则创建
    let user = await this.users.findByWechatOpenId(openid);
    if (!user) {
      user = await this.createUser(openid);
    }

    // 3. 签发 CoTrip 应用 token
    const token = this.tokens.sign(user.id);

    return { token, user: toPublicUser(user) };
  }

  async getProfile(userId: string): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new AppError(404, 'AUTH_UNAUTHORIZED', '用户不存在');
    }
    return toPublicUser(user);
  }

  async updateProfile(
    userId: string,
    patch: { nickname?: string; avatarUrl?: string },
  ): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new AppError(404, 'AUTH_UNAUTHORIZED', '用户不存在');
    }

    // 仅允许编辑公开资料字段；id / wechatOpenId / createdAt 不可修改
    if (patch.nickname !== undefined) {
      const nickname = patch.nickname.trim();
      if (!nickname || nickname.length > 30) {
        throw new AppError(400, 'VALIDATION_ERROR', '昵称长度需在 1-30 个字符之间');
      }
      user.nickname = nickname;
    }
    if (patch.avatarUrl !== undefined) {
      user.avatarUrl = patch.avatarUrl.trim();
    }

    // profileCompleted 唯一语义：拥有合法、非空且非默认占位的昵称——按最终昵称重算，
    // 仅更新头像不会置位；身份来自已认证 userId，客户端无法伪造该标记
    user.profileCompleted = isRealNickname(user.nickname);
    user.updatedAt = Date.now();
    await this.users.update(user);
    return toPublicUser(user);
  }

  private async createUser(openid: string): Promise<User> {
    const now = Date.now();
    const user: User = {
      id: this.generateId(),
      wechatOpenId: openid,
      // 新账号使用安全默认资料，不假设 wx.login 提供真实昵称/头像；真实资料由首次资料完善流程保存
      nickname: DEFAULT_USER_NICKNAME,
      avatarUrl: '',
      profileCompleted: false,
      createdAt: now,
      updatedAt: now,
    };
    try {
      return await this.users.create(user);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(500, 'USER_PERSISTENCE_FAILURE', '用户创建失败');
    }
  }

  private generateId(): string {
    return `u_${crypto.randomBytes(12).toString('hex')}`;
  }
}