// config/auth.ts
// 认证配置：显式指定认证模式。
//
//   mode: 'mock'  → 使用 MockAuthService，前端无需后端即可运行（开发默认）。
//   mode: 'real'  → 使用 RealAuthService，走 wx.login + CoTrip Backend。
//
// 注意：real 模式下若后端不可用，登录会明确失败，绝不静默回退到 Mock。

export const authConfig = {
  /** 认证模式：'mock' | 'real' */
  mode: 'mock' as 'mock' | 'real',
  /** 后端服务地址，例如 'https://api.example.com'（仅 real 模式使用） */
  baseUrl: 'https://api.yipziwun.asia',
  /** 登录态在本地缓存的 key */
  tokenStorageKey: 'cotrip_auth_token',
  userStorageKey: 'cotrip_auth_user',
};
