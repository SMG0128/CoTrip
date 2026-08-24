// server/tests/auth.test.ts
// 聚焦认证单元测试：token 服务、用户仓库、登录流程、资料更新。

import assert from 'assert';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { HmacTokenService } from '../src/services/token-service';
import { JsonUserRepository } from '../src/repositories/json-user-repository';
import { RealAuthService } from '../src/services/auth-service';
import { WechatService } from '../src/services/wechat-service';
import { AppError } from '../src/types/errors';
import { record } from './run-tests';

/** 可控的微信服务桩，用于测试登录流程 */
class FakeWechatService implements WechatService {
  constructor(private readonly openid: string) {}
  async code2Session(code: string) {
    if (code === 'invalid-code') {
      throw new AppError(400, 'AUTH_INVALID_CODE', '登录凭证无效或已过期，请重试');
    }
    return { openid: this.openid, sessionKey: 'fake-session-key' };
  }
}

function tempRepo(): JsonUserRepository {
  const file = path.join(os.tmpdir(), `cotrip-test-${Date.now()}-${Math.random()}.json`);
  return new JsonUserRepository(file);
}

function temporaryStore(): { directory: string; file: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cotrip-users-'));
  return { directory, file: path.join(directory, 'users.json') };
}

function signedToken(payload: unknown, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = require('crypto')
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64url');
  return `${body}.${signature}`;
}

export async function runAuthTests(): Promise<void> {
  // --- Token 服务 ---
  await record('token: 签发后可校验并还原 userId', () => {
    const tokens = new HmacTokenService('test-secret');
    const token = tokens.sign('u_123');
    const payload = tokens.verify(token);
    assert.strictEqual(payload.userId, 'u_123');
    assert.ok(payload.exp > Date.now());
  });

  await record('token: 篡改签名应校验失败', () => {
    const tokens = new HmacTokenService('test-secret');
    const token = tokens.sign('u_123');
    const [body] = token.split('.');
    const tampered = `${body}.forged-signature`;
    assert.throws(() => tokens.verify(tampered), (e: AppError) => e.code === 'AUTH_INVALID_TOKEN');
  });

  await record('token: 过期 token 应报 AUTH_TOKEN_EXPIRED', () => {
    const tokens = new HmacTokenService('test-secret');
    // 构造一个已过期的 payload
    const expired = Buffer.from(JSON.stringify({ userId: 'u_1', exp: Date.now() - 1000 })).toString(
      'base64url',
    );
    const sig = require('crypto')
      .createHmac('sha256', 'test-secret')
      .update(expired)
      .digest('base64url');
    assert.throws(() => tokens.verify(`${expired}.${sig}`), (e: AppError) => e.code === 'AUTH_TOKEN_EXPIRED');
  });

  await record('token: 签名正确但 payload 类型非法仍应拒绝', () => {
    const secret = 'test-secret';
    const tokens = new HmacTokenService(secret);
    const malformed = signedToken({ userId: { spoofed: true }, exp: Date.now() + 60_000 }, secret);
    assert.throws(
      () => tokens.verify(malformed),
      (e: AppError) => e.code === 'AUTH_INVALID_TOKEN',
    );
  });

  // --- 用户仓库 ---
  await record('repository: 按 openid 与 id 查找、创建、更新', async () => {
    const repo = tempRepo();
    const user = {
      id: 'u_1',
      wechatOpenId: 'openid_1',
      nickname: '微信用户',
      avatarUrl: '',
      createdAt: 1,
      updatedAt: 1,
    };
    await repo.create(user);
    assert.strictEqual((await repo.findByWechatOpenId('openid_1'))?.id, 'u_1');
    assert.strictEqual((await repo.findById('u_1'))?.nickname, '微信用户');
    await repo.update({ ...user, nickname: '新昵称' });
    assert.strictEqual((await repo.findById('u_1'))?.nickname, '新昵称');
  });

  await record('repository: 数据在重启后保留（文件持久化）', async () => {
    const file = path.join(os.tmpdir(), `cotrip-restart-${Date.now()}-${Math.random()}.json`);
    const repo1 = new JsonUserRepository(file);
    await repo1.create({
      id: 'u_persist',
      wechatOpenId: 'openid_persist',
      nickname: '微信用户',
      avatarUrl: '',
      createdAt: 1,
      updatedAt: 1,
    });
    // 模拟重启：用同一文件新建仓库
    const repo2 = new JsonUserRepository(file);
    assert.strictEqual((await repo2.findByWechatOpenId('openid_persist'))?.id, 'u_persist');
    fs.rmSync(file, { force: true });
  });

  await record('repository: 损坏 JSON 明确失败且不会被静默清空', () => {
    const temp = temporaryStore();
    try {
      fs.writeFileSync(temp.file, '{broken json', 'utf8');
      assert.throws(
        () => new JsonUserRepository(temp.file),
        (error: AppError) => error.code === 'USER_PERSISTENCE_FAILURE',
      );
      assert.strictEqual(fs.readFileSync(temp.file, 'utf8'), '{broken json');
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  // --- 登录流程 ---
  await record('login: 新用户创建并返回 token + 公开用户（不含 openid）', async () => {
    const repo = tempRepo();
    const auth = new RealAuthService(repo, new FakeWechatService('openid_new'), new HmacTokenService('s'));
    const result = await auth.login('valid-code');
    assert.ok(result.token);
    assert.strictEqual(result.user.nickname, '微信用户');
    assert.ok(!('wechatOpenId' in result.user), '公开用户不应包含 openid');
    assert.ok(!('openid' in result.user), '公开用户不应包含 openid');
  });

  await record('login: 老用户复用同一 CoTrip id', async () => {
    const repo = tempRepo();
    const auth = new RealAuthService(repo, new FakeWechatService('openid_same'), new HmacTokenService('s'));
    const first = await auth.login('code-1');
    const second = await auth.login('code-2');
    assert.strictEqual(first.user.id, second.user.id);
  });

  await record('login: 同一 openid 并发首次登录只创建一个 CoTrip 身份', async () => {
    const temp = temporaryStore();
    try {
      const repo = new JsonUserRepository(temp.file);
      const auth = new RealAuthService(
        repo,
        new FakeWechatService('openid_concurrent'),
        new HmacTokenService('s'),
      );
      const [first, second] = await Promise.all([
        auth.login('code-1'),
        auth.login('code-2'),
      ]);
      assert.strictEqual(first.user.id, second.user.id);

      const persisted = JSON.parse(fs.readFileSync(temp.file, 'utf8')) as {
        users: Array<{ wechatOpenId: string }>;
      };
      assert.strictEqual(
        persisted.users.filter((user) => user.wechatOpenId === 'openid_concurrent').length,
        1,
      );
    } finally {
      fs.rmSync(temp.directory, { recursive: true, force: true });
    }
  });

  await record('login: 无效 code 应抛 AUTH_INVALID_CODE', async () => {
    const repo = tempRepo();
    const auth = new RealAuthService(repo, new FakeWechatService('openid_x'), new HmacTokenService('s'));
    await assert.rejects(() => auth.login('invalid-code'), (e: AppError) => e.code === 'AUTH_INVALID_CODE');
  });

  await record('login: 缺少 code 应抛 AUTH_MISSING_CODE', async () => {
    const repo = tempRepo();
    const auth = new RealAuthService(repo, new FakeWechatService('openid_x'), new HmacTokenService('s'));
    await assert.rejects(() => auth.login(''), (e: AppError) => e.code === 'AUTH_MISSING_CODE');
  });

  // --- 资料更新 ---
  await record('profile: 更新昵称/头像，且不可改 id/openid', async () => {
    const repo = tempRepo();
    const auth = new RealAuthService(repo, new FakeWechatService('openid_p'), new HmacTokenService('s'));
    const { user, token } = await auth.login('code');
    const updated = await auth.updateProfile(user.id, { nickname: '小明', avatarUrl: 'http://a.png' });
    assert.strictEqual(updated.nickname, '小明');
    assert.strictEqual(updated.avatarUrl, 'http://a.png');
    assert.strictEqual(updated.id, user.id);
    // 校验 token 仍有效
    assert.strictEqual(new HmacTokenService('s').verify(token).userId, user.id);
  });

  await record('profile: 空昵称应抛 VALIDATION_ERROR', async () => {
    const repo = tempRepo();
    const auth = new RealAuthService(repo, new FakeWechatService('openid_v'), new HmacTokenService('s'));
    const { user } = await auth.login('code');
    await assert.rejects(() => auth.updateProfile(user.id, { nickname: '   ' }), (e: AppError) => e.code === 'VALIDATION_ERROR');
  });
  // --- 资料完善标记（profileCompleted） ---
  await record('login: 新用户 profileCompleted=false 且公开用户携带该标记', async () => {
    const repo = tempRepo();
    const auth = new RealAuthService(repo, new FakeWechatService('openid_fresh'), new HmacTokenService('s'));
    const result = await auth.login('code');
    assert.strictEqual(result.user.profileCompleted, false);
  });

  await record('profile: 真实保存昵称后 profileCompleted=true 并持久化', async () => {
    const repo = tempRepo();
    const auth = new RealAuthService(repo, new FakeWechatService('openid_save'), new HmacTokenService('s'));
    const { user } = await auth.login('code');
    const updated = await auth.updateProfile(user.id, { nickname: '小明' });
    assert.strictEqual(updated.profileCompleted, true);
    // 模拟重启：落盘值也应携带该标记
    const persisted = await repo.findById(user.id);
    assert.strictEqual(persisted?.profileCompleted, true);
    assert.strictEqual((await auth.getProfile(user.id)).profileCompleted, true);
  });

  await record('profile: 空昵称校验失败不置位 profileCompleted', async () => {
    const repo = tempRepo();
    const auth = new RealAuthService(repo, new FakeWechatService('openid_invalid'), new HmacTokenService('s'));
    const { user } = await auth.login('code');
    await assert.rejects(() => auth.updateProfile(user.id, { nickname: '   ' }), (e: AppError) => e.code === 'VALIDATION_ERROR');
    // 校验失败先抛 AppError，不应走到置位行
    assert.strictEqual((await repo.findById(user.id))?.profileCompleted, false);
  });

  await record('profile: 历史用户(无标记但已自定义昵称)视为已完成', async () => {
    const repo = tempRepo();
    // 历史数据：无 profileCompleted 字段，仅靠昵称兜底判断
    await repo.create({
      id: 'u_legacy',
      wechatOpenId: 'openid_legacy',
      nickname: '老张',
      avatarUrl: '',
      createdAt: 1,
      updatedAt: 1,
    });
    const auth = new RealAuthService(repo, new FakeWechatService('openid_x'), new HmacTokenService('s'));
    const profile = await auth.getProfile('u_legacy');
    assert.strictEqual(profile.profileCompleted, true);
  });

  await record('profile: 新用户仅改头像不完成资料（无合法昵称时保持 false）', async () => {
    const repo = tempRepo();
    const auth = new RealAuthService(repo, new FakeWechatService('openid_avatar'), new HmacTokenService('s'));
    const { user } = await auth.login('code');
    const updated = await auth.updateProfile(user.id, { avatarUrl: 'http://a.png' });
    assert.strictEqual(updated.profileCompleted, false);
    const persisted = await repo.findById(user.id);
    assert.strictEqual(persisted?.profileCompleted, false);
  });

  await record('profile: 已有合法昵称的用户仅改头像保持已完成', async () => {
    const repo = tempRepo();
    const auth = new RealAuthService(repo, new FakeWechatService('openid_avatar_ok'), new HmacTokenService('s'));
    const { user } = await auth.login('code');
    await auth.updateProfile(user.id, { nickname: '小明' });
    const updated = await auth.updateProfile(user.id, { avatarUrl: 'http://a.png' });
    assert.strictEqual(updated.profileCompleted, true);
    assert.strictEqual((await repo.findById(user.id))?.profileCompleted, true);
  });

  await record('profile: 显式改回默认占位名视为未完成资料', async () => {
    const repo = tempRepo();
    const auth = new RealAuthService(repo, new FakeWechatService('openid_reset'), new HmacTokenService('s'));
    const { user } = await auth.login('code');
    await auth.updateProfile(user.id, { nickname: '小明' });
    const reset = await auth.updateProfile(user.id, { nickname: '微信用户' });
    assert.strictEqual(reset.profileCompleted, false);
  });

  await record('profile: 昵称与标记在重启后持久化', async () => {
    const file = path.join(os.tmpdir(), `cotrip-profile-${Date.now()}-${Math.random()}.json`);
    const repo1 = new JsonUserRepository(file);
    const auth1 = new RealAuthService(
      repo1,
      new FakeWechatService('openid_restart'),
      new HmacTokenService('s')
    );
    const { user } = await auth1.login('code');
    await auth1.updateProfile(user.id, { nickname: '重启小明', avatarUrl: 'data:image/png;base64,QQ==' });
    // 模拟重启：用同一文件新建仓库实例读取落盘数据
    const repo2 = new JsonUserRepository(file);
    const persisted = await repo2.findById(user.id);
    assert.strictEqual(persisted?.nickname, '重启小明');
    assert.strictEqual(persisted?.avatarUrl, 'data:image/png;base64,QQ==');
    assert.strictEqual(persisted?.profileCompleted, true);
    fs.rmSync(file, { force: true });
  });

  await record('profile: 改回默认昵称即使已有微信头像仍视为未完成', async () => {
    const repo = tempRepo();
    const auth = new RealAuthService(repo, new FakeWechatService('openid_reset2'), new HmacTokenService('s'));
    const { user } = await auth.login('code');
    await auth.updateProfile(user.id, {
      nickname: '小明',
      avatarUrl: 'https://wx.qlogo.cn/mmopen/a.png',
    });
    const reset = await auth.updateProfile(user.id, { nickname: '微信用户' });
    assert.strictEqual(reset.profileCompleted, false);
    // 头像保留，不因昵称重置被清除（头像不参与完成判定）
    assert.strictEqual(reset.avatarUrl, 'https://wx.qlogo.cn/mmopen/a.png');
  });
}
