// utils/departure-places.ts
// 默认出发地点管理：行程详情「我的推荐」的起始地点候选。
// 出发地点是个人隐私数据（仅用于计算个人路线，不向其他参与者公开），
// V1 存本地 storage，不经后端。纯函数与存储分层，纯函数可单测。

import { Location } from '../types/location';

const STORAGE_KEY = 'cotrip_departure_places';

/** 由坐标生成稳定地点 ID（wx.chooseLocation 不返回外部地点 ID） */
export function buildPlaceId(latitude: number, longitude: number): string {
  return `wx_poi_${longitude.toFixed(6)}_${latitude.toFixed(6)}`;
}

/** 由地图选点结果构建出发地点 */
export function buildDeparturePlace(input: {
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
}): Location {
  return {
    id: buildPlaceId(input.latitude, input.longitude),
    name: input.name || input.address || '出发地点',
    latitude: input.latitude,
    longitude: input.longitude,
    address: input.address || '',
  };
}

/** 合并一条出发地点：同坐标视为同一地点（更新信息并移到首位），新地点插到首位 */
export function mergeDeparturePlace(list: Location[], place: Location): Location[] {
  const rest = list.filter((item) => item.id !== place.id);
  return [place, ...rest];
}

/** 删除指定出发地点，返回新列表 */
export function removeDeparturePlace(list: Location[], id: string): Location[] {
  return list.filter((item) => item.id !== id);
}

/** 解析 storage 原始值：损坏/缺字段数据安全丢弃，绝不抛错 */
export function parseStoredPlaces(raw: unknown): Location[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is Location =>
      !!item &&
      typeof item === 'object' &&
      typeof (item as Location).id === 'string' &&
      typeof (item as Location).name === 'string' &&
      typeof (item as Location).latitude === 'number' &&
      typeof (item as Location).longitude === 'number',
  );
}

/** 读取本地出发地点列表（首位即默认出发点） */
export function loadDeparturePlaces(): Location[] {
  try {
    return parseStoredPlaces(wx.getStorageSync(STORAGE_KEY));
  } catch {
    return [];
  }
}

/** 持久化出发地点列表 */
export function saveDeparturePlaces(list: Location[]): void {
  try {
    wx.setStorageSync(STORAGE_KEY, list);
  } catch {
    // 存储失败不阻断流程：列表仍在本页内存中可用
  }
}
