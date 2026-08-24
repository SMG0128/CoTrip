// config/auth.ts
// 应用运行配置。登录与行程数据一律走真实后端；Mock 不再是一种运行模式，
// 仅剩一条内置示例行程（见 utils/demo-trip.ts），由 enableDemoTrip 控制是否展示。
//
// 注意：后端不可用时登录/行程请求会明确失败并展示错误状态，绝不静默回退到 Mock。

export const appConfig = {
  /** 是否在首页展示内置示例行程（仅本地演示数据，不与后端交互） */
  enableDemoTrip: true,
  /** 后端服务地址，例如 'https://api.example.com' */
  baseUrl: 'https://api.yipziwun.asia',
  /** 登录态在本地缓存的 key */
  tokenStorageKey: 'cotrip_auth_token',
  userStorageKey: 'cotrip_auth_user',
};
