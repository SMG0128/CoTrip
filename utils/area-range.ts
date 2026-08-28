// utils/area-range.ts
// 区域限定「指定范围」辅助：把模糊定位点换算为地图范围 bounds。
// 纯函数、无 wx.* 依赖，保证可单测。

import { AreaConstraint } from '../types/constraint';

/** 一纬度度约对应 111 公里 */
const KM_PER_LATITUDE_DEGREE = 111;

/** 换算结果统一保留 6 位小数（约 0.1 米级），消除浮点噪声 */
const round6 = (value: number): number => Number(value.toFixed(6));

export type RangeBounds = NonNullable<AreaConstraint['mapBounds']>;

/**
 * 以定位点为中心、指定半径（公里）构建 gcj02 地图范围。
 * 与小程序 map 组件 / wx.chooseLocation 的坐标系保持一致；
 * 半径按模糊定位精度选择（getFuzzyLocation 约 1 公里），
 * 经度方向按纬度余弦收窄，保证地面距离近似等于半径。
 */
export function buildRangeBounds(
  latitude: number,
  longitude: number,
  radiusKm: number,
): RangeBounds {
  const dLat = radiusKm / KM_PER_LATITUDE_DEGREE;
  const dLng =
    radiusKm / (KM_PER_LATITUDE_DEGREE * Math.cos((latitude * Math.PI) / 180));
  return {
    northeast: {
      latitude: round6(latitude + dLat),
      longitude: round6(longitude + dLng),
    },
    southwest: {
      latitude: round6(latitude - dLat),
      longitude: round6(longitude - dLng),
    },
  };
}
