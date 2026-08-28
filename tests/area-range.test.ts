// tests/area-range.test.ts
// 指定范围 bounds 纯函数测试：
// - 中心对称性：东北/西南角关于定位点对称
// - 半弧长：3 公里半径约 0.027 纬度；经度弧长按纬度余弦放大
// - 圆整：输出固定 6 位小数

import { buildRangeBounds } from '../utils/area-range';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

function closeTo(actual: number, expected: number, tolerance: number, msg: string) {
  assert(Math.abs(actual - expected) <= tolerance, msg);
}

// ---- 1. 广州纬度：中心对称 + 半弧长 ----
{
  const lat = 23.129;
  const lng = 113.264;
  const bounds = buildRangeBounds(lat, lng, 3);
  closeTo((bounds.northeast.latitude + bounds.southwest.latitude) / 2, lat, 1e-6, '纬度应关于定位点对称');
  closeTo((bounds.northeast.longitude + bounds.southwest.longitude) / 2, lng, 1e-6, '经度应关于定位点对称');
  closeTo(bounds.northeast.latitude - lat, 3 / 111, 1e-5, '3 公里半径约 0.027 纬度');
  // 广州纬度 cos ≈ 0.920，经度半弧长应比纬度放大约 1/0.92
  const dLng = bounds.northeast.longitude - lng;
  const dLat = bounds.northeast.latitude - lat;
  closeTo(dLng / dLat, 1 / Math.cos((lat * Math.PI) / 180), 1e-3, '经度弧长按纬度余弦放大');
  assert(bounds.northeast.latitude > bounds.southwest.latitude, '东北角纬度应大于西南角');
  assert(bounds.northeast.longitude > bounds.southwest.longitude, '东北角经度应大于西南角');
}

// ---- 2. 赤道：经纬弧长相等 ----
{
  const bounds = buildRangeBounds(0, 0, 1);
  closeTo(bounds.northeast.latitude - bounds.southwest.latitude, 2 / 111, 1e-5, '赤道纬度全弧长约 2/111');
  closeTo(
    bounds.northeast.longitude - bounds.southwest.longitude,
    bounds.northeast.latitude - bounds.southwest.latitude,
    1e-6,
    '赤道处经纬弧长应相等',
  );
}

// ---- 3. 圆整：输出为 6 位小数 ----
{
  const bounds = buildRangeBounds(23.129083, 113.264412, 3);
  const decimals = (n: number): number => (String(n).split('.')[1] || '').length;
  assert(decimals(bounds.northeast.latitude) <= 6, '纬度应圆整到 6 位小数');
  assert(decimals(bounds.northeast.longitude) <= 6, '经度应圆整到 6 位小数');
  assert(decimals(bounds.southwest.latitude) <= 6, '西南纬度应圆整到 6 位小数');
  assert(decimals(bounds.southwest.longitude) <= 6, '西南经度应圆整到 6 位小数');
}

console.log('✅ area-range.test.ts 全部通过');
