// resolved-physical-location.ts
// Tencent 已验证物理地点的通用不变量与地址补全 helper。
//
// address 是 truth-preserving factual field：仅保留 Tencent search / reverse geocode
// 实际返回的非空值；补全失败时保持 undefined，绝不推断或填充占位地址。

export interface ResolvedPhysicalLocation {
  provider: 'tencent';
  providerPoiId: string;
  name: string;
  latitude: number;
  longitude: number;
  address?: string;
}

export type ReverseGeocodeAddress = (
  latitude: number,
  longitude: number,
) => Promise<string | undefined>;

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validLatitude(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 90;
}

function validLongitude(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180;
}

/**
 * resolved Tencent physical location 的统一判定：Provider 身份、POI id、名称与合法坐标齐全。
 * address 不参与 resolved 判定，因为 Tencent 仍可能同时不给 search/reverse address。
 */
export function isResolvedPhysicalLocation(
  location: Partial<ResolvedPhysicalLocation> | null | undefined,
): location is ResolvedPhysicalLocation {
  return !!location
    && location.provider === 'tencent'
    && nonEmpty(location.providerPoiId)
    && nonEmpty(location.name)
    && validLatitude(location.latitude)
    && validLongitude(location.longitude);
}

export function hasCompletePhysicalAddress(
  location: Partial<ResolvedPhysicalLocation> | null | undefined,
): boolean {
  return isResolvedPhysicalLocation(location) && nonEmpty(location.address);
}

/**
 * 对任意已解析 Tencent POI 尽最大可能补全真实地址。
 *
 * - search 已返回 address：直接使用，不调用 reverse geocode。
 * - address 缺失但坐标有效：调用同一 Tencent Provider 的 reverse geocode。
 * - reverse geocode 无结果或失败：保持 address undefined。
 */
export async function enrichTencentLocationAddress<T extends ResolvedPhysicalLocation>(
  location: T,
  reverseGeocode: ReverseGeocodeAddress,
): Promise<T> {
  if (!isResolvedPhysicalLocation(location)) return location;
  if (nonEmpty(location.address)) return { ...location, address: location.address.trim() };

  const { address: _emptyAddress, ...withoutEmptyAddress } = location;
  try {
    const address = await reverseGeocode(location.latitude, location.longitude);
    if (!nonEmpty(address)) return withoutEmptyAddress as T;
    return { ...withoutEmptyAddress, address: address.trim() } as T;
  } catch {
    return withoutEmptyAddress as T;
  }
}
