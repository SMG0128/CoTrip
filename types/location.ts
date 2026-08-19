// types/location.ts
// Location 必须是结构化对象，禁止退化为普通字符串。

export interface Location {
  id: string;
  name: string;
  latitude?: number;
  longitude?: number;
  address?: string;
  district?: string;
  city?: string;
  /** 第三方 Provider 引用，如 { tencent_map: 'poi_id' } */
  providerRefs?: Record<string, string>;
}