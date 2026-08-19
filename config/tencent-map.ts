// config/tencent-map.ts
// 腾讯位置服务配置层。
// 安全边界：只放允许客户端使用的公开配置。
// 若某个 Key 属于必须由服务端保护的 Secret，必须走后端/云函数，禁止写入前端。

export interface TencentMapConfig {
  /** 腾讯位置服务 WebService API Key（客户端公开 Key） */
  key: string;
  /** 腾讯地图 URI 基础地址 */
  uriBase: string;
  /** 地点搜索 API */
  placeSearchUrl: string;
  /** 默认城市 */
  defaultCity: string;
  /** referer（用于 URI 校验） */
  referer: string;
}

/**
 * 腾讯地图公开配置。
 * 注意：这里使用占位符，真实 Key 请通过环境变量 / 云函数注入，禁止提交真实 Secret 到 Git。
 */
export const tencentMapConfig: TencentMapConfig = {
  key: 'YOUR_TENCENT_MAP_KEY',
  uriBase: 'https://apis.map.qq.com/uri/v1/',
  placeSearchUrl: 'https://apis.map.qq.com/ws/place/v1/search',
  defaultCity: '广州市',
  referer: 'cotrip-miniprogram',
};

/** 是否已配置真实 Key（用于判断是否走真实 API 还是 Seed Fallback） */
export function isTencentMapConfigured(): boolean {
  return tencentMapConfig.key !== 'YOUR_TENCENT_MAP_KEY' && tencentMapConfig.key.length > 0;
}