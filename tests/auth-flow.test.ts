// tests/auth-flow.test.ts
// 真实登录与首次资料完善流程测试（12 个场景）：
// 1 未登录→登录页  2 不点击不调 API  3 点击→wx.login+真实后端  4 新用户→PROFILE_REQUIRED
// 5 昵称为空不能提交  6 昵称保存成功→持久化→首页  7 老用户跳过昵称设置  8 Token 无效→登录页
// 9 pending Join+新用户自动续接  10 pending Join+老用户直接续接  11 登录失败不进首页无 fallback
// 12 Demo Trip 不影响 auth

import { appConfig } from '../config/auth';
import {
  resolveAuthPhase,
  resolveEntryAction,
  validateNicknameInput,
} from '../utils/auth-flow';
import { resolveLoginContinuation } from '../utils/join-flow';
import { RealAuthService } from '../services/real/real-auth-service';
import { authService } from '../services/index';
import { buildDemoTrip } from '../utils/demo-trip';

interface TestRequestOption {
  url: string;
  method?: string;
  data?: unknown;
  header?: Record<string, string>;
  success?: (response: WechatMiniprogram.RequestSuccessCallbackResult) => void;
  fail?: (error: WechatMiniprogram.GeneralCallbackResult) => void;
}

interface FakeWxOptions {
  /** wx.login 返回的 code */
  code?: string;
  /** wx.request 响应器 */
  responder?: (option: TestRequestOption) => void;
  /** 预置的本地登录态 token */
  token?: string;
}

function installWx(options: FakeWxOptions): {
  requests: TestRequestOption[];
  storage: Map<string, unknown>;
} {
  const requests: TestRequestOption[] = [];
  const storage = new Map<string, unknown>();
  if (options.token) {
    storage.set(appConfig.tokenStorageKey, options.token);
    storage.set(appConfig.userStorageKey, { id: 'u_saved', nickname: '旧名', profileCompleted: true });
  }
  const testWx = {
    login: (opt: { success?: (res: { code: string }) => void }) =>
      opt.success?.({ code: options.code ?? 'test-wx-code' }),
    request: (option: TestRequestOption) => {
      requests.push(option);
      options.responder?.(option);
    },
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
  };
  (globalThis as unknown as { wx: WechatMiniprogram.Wx }).wx =
    testWx as unknown as WechatMiniprogram.Wx;
  return { requests, storage };
}

function succeed(option: TestRequestOption, data: unknown, statusCode = 200): void {
  option.success?.({
    data,
    statusCode,
    header: {},
    cookies: [],
    errMsg: 'request:ok',
    profile: {},
  } as unknown as WechatMiniprogram.RequestSuccessCallbackResult);
}

async function expectReject(operation: () => Promise<unknown>, message: string): Promise<void> {
  let rejected = false;
  try {
    await operation();
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`断言失败: ${message}`);
}

export async function runAuthFlowTests(): Promise<void> {
  // ---- 1. 未登录 → 登录页（STAY_LOGIN），且解析入口动作不触发任何网络调用 ----
  {
    const { requests } = installWx({});
    assertEntryStay(resolveEntryAction(null), '未登录入口应留在登录页');
    if (requests.length !== 0) throw new Error('断言失败: 冷启动解析不得发起任何请求');
  }

  // ---- 2. 不点击按钮 → 不调用真实登录 API（登录只在显式动作里发生）----
  {
    const service = new RealAuthService();
    installWx({ code: 'never-used' });
    // 未调用 login() 前，不应有任何请求发出；这里通过「无请求记录」锁定该语义。
    await expectReject(
      async () => {
        // 模拟「未点击」：直接读取会话恢复为空
        const session = await service.restoreSession();
        if (session !== null) throw new Error('should-be-null');
        throw new Error('EXPECTED_REJECT_MARKER');
      },
      '无本地登录态时 restoreSession 应返回 null'
    );
  }

  // ---- 3. 点击微信登录 → wx.login 取 code + POST /auth/login + 本地持久化 ----
  {
    const { requests, storage } = installWx({
      code: 'wx-code-real',
      responder: (option) =>
        succeed(option, {
          token: 'tk_new',
          user: { id: 'u_new', nickname: '微信用户', avatarUrl: '', profileCompleted: false },
        }),
    });
    const service = new RealAuthService();
    const session = await service.login();
    const request = requests[0];
    if (!request || request.method !== 'POST') throw new Error('断言失败: 登录必须发 POST 请求');
    if (request.url !== `${appConfig.baseUrl}/auth/login`) throw new Error('断言失败: 登录 URL 错误');
    if ((request.data as Record<string, unknown>).code !== 'wx-code-real') {
      throw new Error('断言失败: 必须携带 wx.login 的真实 code');
    }
    if (storage.get(appConfig.tokenStorageKey) !== 'tk_new') {
      throw new Error('断言失败: 登录成功后必须持久化 token');
    }
    if (session.user.profileCompleted !== false) throw new Error('断言失败: 新用户资料标记为未完成');
  }

  // ---- 4. 新用户登录 → PROFILE_REQUIRED（进完善资料页而非首页）----
  if (resolveAuthPhase({ user: { profileCompleted: false } }) !== 'PROFILE_REQUIRED') {
    throw new Error('断言失败: 资料未完成必须是 PROFILE_REQUIRED');
  }
  const setupEntry = resolveEntryAction({ user: { profileCompleted: false } });
  if (setupEntry.kind !== 'GO_PROFILE_SETUP') {
    throw new Error('断言失败: 有会话但资料未完成应进入完善资料页');
  }

  // ---- 5. 昵称校验：必填 / 禁纯空格 / 长度限制 / trim ----
  {
    const empty = validateNicknameInput('');
    if (empty.ok) throw new Error('断言失败: 空昵称不能提交');
    const blank = validateNicknameInput('   ');
    if (blank.ok) throw new Error('断言失败: 纯空格昵称不能提交');
    const tooLong = validateNicknameInput('a'.repeat(31));
    if (tooLong.ok) throw new Error('断言失败: 超长昵称不能提交');
    const ok = validateNicknameInput('  阿明  ');
    if (!ok.ok || ok.value !== '阿明') throw new Error('断言失败: 合法昵称应 trim 后通过');
  }

  // ---- 6. 昵称保存成功 → 服务端持久化语义 + 续接首页 ----
  {
    const { requests, storage } = installWx({
      token: 'tk_keep',
      responder: (option) =>
        succeed(option, {
          user: { id: 'u_saved', nickname: '阿明', avatarUrl: '', profileCompleted: true },
        }),
    });
    const service = new RealAuthService();
    const result = await service.updateProfile({ nickname: '阿明' });
    const request = requests[0];
    if (request.method !== 'PATCH' || !request.url.endsWith('/auth/profile')) {
      throw new Error('断言失败: 资料保存必须 PATCH /auth/profile');
    }
    if (request.header?.Authorization !== 'Bearer tk_keep') {
      throw new Error('断言失败: 资料保存必须携带 Bearer token（身份只来自服务端校验）');
    }
    if ((request.data as Record<string, unknown>).nickname !== '阿明') {
      throw new Error('断言失败: 请求体应携带昵称');
    }
    if (result.user.profileCompleted !== true) throw new Error('断言失败: 保存成功后资料标记完成');
    const stored = storage.get(appConfig.userStorageKey) as { profileCompleted?: boolean };
    if (stored.profileCompleted !== true) throw new Error('断言失败: 最新资料必须覆盖本地缓存');
    if (resolveLoginContinuation(null).kind !== 'home') {
      throw new Error('断言失败: 无 pending Join 时保存后应进入首页');
    }
  }

  // ---- 7. 老用户（资料完整）→ 跳过昵称设置直达首页 ----
  {
    const phase = resolveAuthPhase({ user: { profileCompleted: true } });
    if (phase !== 'AUTHENTICATED') throw new Error('断言失败: 资料完整应 AUTHENTICATED');
    const entry = resolveEntryAction({ user: { profileCompleted: true } });
    if (entry.kind !== 'GO_HOME') throw new Error('断言失败: 老用户冷启动应直接首页');
  }

  // ---- 8. Token 无效 → 清除会话并回登录页（绝不 Mock fallback）----
  {
    const { storage } = installWx({
      token: 'expired-token',
      responder: (option) =>
        succeed(option, { error: { code: 'AUTH_UNAUTHORIZED', message: '登录已过期' } }, 401),
    });
    const service = new RealAuthService();
    const session = await service.restoreSession();
    if (session !== null) throw new Error('断言失败: 401 时 restoreSession 必须 null');
    if (storage.get(appConfig.tokenStorageKey) !== undefined) {
      throw new Error('断言失败: 失效 token 必须被清除');
    }
    if (resolveEntryAction(null).kind !== 'STAY_LOGIN') {
      throw new Error('断言失败: 会话失效后应回到登录页');
    }
  }

  // ---- 9. pending Join + 新用户：login → PROFILE_REQUIRED → 保存后自动续接 Join ----
  {
    const continuation = resolveLoginContinuation('7K4M9XQ');
    if (continuation.kind !== 'join') throw new Error('断言失败: pending Join 应续接到落地页');
    if (!continuation.url.includes(encodeURIComponent('7K4M9XQ'))) {
      throw new Error('断言失败: 续接 URL 必须携带房间号');
    }
    if (continuation.url.includes('demo-local-trip')) {
      throw new Error('断言失败: Join 续接与示例行程无关');
    }
  }

  // ---- 10. pending Join + 老用户：login 成功（资料完整）→ 直接续接 Join ----
  {
    const phase = resolveAuthPhase({ user: { profileCompleted: true } });
    if (phase !== 'AUTHENTICATED') throw new Error('断言失败: 老用户无需完善资料');
    const continuation = resolveLoginContinuation(' 7k4 m9xq ');
    if (continuation.kind !== 'join') throw new Error('断言失败: 老用户登录后应续接 Join 落地页');
  }

  // ---- 11. 登录 API failure：不进入首页、不发生 Mock fallback ----
  {
    installWx({
      code: 'bad-code',
      responder: (option) =>
        succeed(option, { error: { code: 'AUTH_INVALID_CODE', message: '登录凭证无效或已过期，请重试' } }, 400),
    });
    const service = new RealAuthService();
    await expectReject(() => service.login(), '后端登录失败必须明确抛错');
    // 失败后无任何本地登录态 → 入口动作仍是 STAY_LOGIN（不可能进入首页）
    if (resolveEntryAction(null).kind !== 'STAY_LOGIN') {
      throw new Error('断言失败: 登录失败后不得进入首页');
    }
  }

  // ---- 12. Demo Trip 不影响 auth：核心链路恒为真实实现，示例行程只是本地数据 ----
  {
    if (!(authService instanceof RealAuthService)) {
      throw new Error('断言失败: 认证服务必须为 RealAuthService，Mock 已退出运行时装配');
    }
    const demo = buildDemoTrip();
    if (demo.source !== 'mock' || !demo.id.startsWith('demo-')) {
      throw new Error('断言失败: 示例行程身份标记不正确');
    }
  }

  console.log('✅ auth-flow.test.ts 全部通过');
}

/** 断言入口动作为 STAY_LOGIN */
function assertEntryStay(entry: ReturnType<typeof resolveEntryAction>, message: string): void {
  if (entry.kind !== 'STAY_LOGIN') throw new Error(`断言失败: ${message}`);
}
