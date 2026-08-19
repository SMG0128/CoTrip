// types/location.ts
// Location 必须是结构化对象，禁止退化为普通字符串。

/** Provider 身份引用：记录地点来自哪个 Provider 及其外部 ID */
export interface ProviderRef {
  provider: string;
  externalId?: string;
}

export interface Location {
  id: string;
  name: string;
  latitude?: number;
  longitude?: number;
  address?: string;
  district?: string;
  city?: string;
  /** 第三方 Provider 引用（数组形式，支持多 Provider） */
  providerRefs?: ProviderRef[];
}