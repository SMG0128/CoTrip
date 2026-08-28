// 用户本地保存的出发地点。只保存用户显式选择的公开地点坐标，不请求设备定位。

import { Location } from '../types/location';

const STORAGE_KEY = 'cotrip_departure_places';

export interface DeparturePlace extends Location {
  isDefault: boolean;
  updatedAt: string;
}

export interface BuildDeparturePlaceInput {
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
}

export function buildDeparturePlace(input: BuildDeparturePlaceInput): DeparturePlace {
  if (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)) {
    throw new Error('出发地点坐标无效');
  }
  const now = new Date();
  return {
    id: `departure_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`,
    name: input.name.trim() || input.address?.trim() || '地图选点',
    address: input.address?.trim() || undefined,
    latitude: input.latitude,
    longitude: input.longitude,
    isDefault: true,
    updatedAt: now.toISOString(),
  };
}

export function loadDeparturePlaces(): DeparturePlace[] {
  try {
    const stored = wx.getStorageSync<unknown>(STORAGE_KEY);
    if (!Array.isArray(stored)) return [];
    return stored.filter(isDeparturePlace);
  } catch {
    return [];
  }
}

export function saveDeparturePlaces(places: DeparturePlace[]): void {
  wx.setStorageSync(STORAGE_KEY, places);
}

/** 新选择地点成为唯一默认项；同 id 项被替换，其它项保留。 */
export function mergeDeparturePlace(
  existing: DeparturePlace[],
  selected: DeparturePlace,
): DeparturePlace[] {
  return [
    { ...selected, isDefault: true },
    ...existing
      .filter((place) => place.id !== selected.id)
      .map((place) => ({ ...place, isDefault: false })),
  ];
}

function isDeparturePlace(value: unknown): value is DeparturePlace {
  if (!value || typeof value !== 'object') return false;
  const place = value as Record<string, unknown>;
  return typeof place.id === 'string'
    && typeof place.name === 'string'
    && typeof place.latitude === 'number'
    && Number.isFinite(place.latitude)
    && typeof place.longitude === 'number'
    && Number.isFinite(place.longitude)
    && typeof place.isDefault === 'boolean'
    && typeof place.updatedAt === 'string';
}
