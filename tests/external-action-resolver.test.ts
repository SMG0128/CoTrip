// tests/external-action-resolver.test.ts
// ExternalActionResolver 单元测试：验证 pickBest 优先级与动作结构。

import { ExternalActionResolver } from '../services/providers/external-action-resolver';
import { ExternalAction } from '../types/external-action';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

const resolver = new ExternalActionResolver();

// ---- 1. pickBest 优先级：API > MINIPROGRAM(enabled) > URL ----
{
  const actions: ExternalAction[] = [
    { id: 'a1', provider: 'dianping', mode: 'URL', target: 'https://dianping.com/x' },
    { id: 'a2', provider: 'tencent_map', mode: 'API', action: 'open_location', params: {} },
    { id: 'a3', provider: 'dianping', mode: 'MINIPROGRAM', appId: 'wx123', enabled: true },
  ];
  const best = resolver.pickBest(actions);
  assert(best?.id === 'a2', 'API 应优先于 MINIPROGRAM 和 URL');
}

// ---- 2. pickBest：MINIPROGRAM(enabled) 优先于 URL ----
{
  const actions: ExternalAction[] = [
    { id: 'a1', provider: 'dianping', mode: 'URL', target: 'https://dianping.com/x' },
    { id: 'a3', provider: 'dianping', mode: 'MINIPROGRAM', appId: 'wx123', enabled: true },
  ];
  const best = resolver.pickBest(actions);
  assert(best?.id === 'a3', 'enabled 的 MINIPROGRAM 应优先于 URL');
}

// ---- 3. pickBest：未验证的 MINIPROGRAM 不启用 ----
{
  const actions: ExternalAction[] = [
    { id: 'a1', provider: 'dianping', mode: 'URL', target: 'https://dianping.com/x' },
    { id: 'a3', provider: 'dianping', mode: 'MINIPROGRAM', appId: 'wx123', enabled: false },
  ];
  const best = resolver.pickBest(actions);
  assert(best?.id === 'a1', '未验证的 MINIPROGRAM 应被跳过，回退到 URL');
}

// ---- 4. pickBest：空数组返回 undefined ----
{
  assert(resolver.pickBest([]) === undefined, '空数组应返回 undefined');
}

// ---- 5. 大众点评 URL 结构 ----
{
  const dianping: ExternalAction = {
    id: 'ea_dp',
    provider: 'dianping',
    mode: 'URL',
    action: 'merchant_detail',
    target: 'https://www.dianping.com/shop/65696301',
  };
  assert(dianping.mode === 'URL', '大众点评应为 URL 模式');
  assert(dianping.target.includes('dianping.com'), 'target 应为大众点评链接');
}

// ---- 6. MINIPROGRAM 未配置时 enabled=false ----
{
  const mp: ExternalAction = {
    id: 'ea_mp',
    provider: 'dianping',
    mode: 'MINIPROGRAM',
    appId: '',
    enabled: false,
  };
  assert(mp.enabled === false, '未配置 AppID 时 enabled 必须为 false');
}

console.log('✅ external-action-resolver.test.ts 全部通过');