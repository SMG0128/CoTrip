// tests/tencent-map-adapter.test.ts
// 腾讯地图 Adapter 单元测试：验证 Provider DTO → CoTrip Entity 转换。

import { TencentMapAdapter } from '../services/providers/tencent-map-provider';
import { tencentMapUriBuilder } from '../services/providers/tencent-map-uri-builder';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

const adapter = new TencentMapAdapter();

// ---- 1. POI → Location 转换 ----
{
  const poi = {
    id: 'poi_123',
    title: '越芽越南餐室',
    address: '广州市越秀区淘金北路17号地下室',
    category: '美食;越南菜',
    type: 0,
    location: { lat: 23.1372, lng: 113.2789 },
  };
  const loc = adapter.toLocation(poi, 'tencent_map');
  assert(loc.name === '越芽越南餐室', '名称应正确');
  assert(loc.latitude === 23.1372 && loc.longitude === 113.2789, '经纬度应正确');
  assert(loc.district === '越秀区', `区名应提取为越秀区，实际 ${loc.district}`);
  assert(loc.providerRefs?.[0].provider === 'tencent_map', 'provider 应为 tencent_map');
  assert(loc.providerRefs?.[0].externalId === 'poi_123', 'externalId 应为腾讯 POI ID');
  // 不要把腾讯 POI ID 当作 CoTrip 主键
  assert(loc.id !== 'poi_123', 'CoTrip id 不应等于腾讯 POI ID');
}

// ---- 2. POI → Restaurant 转换 ----
{
  const poi = {
    id: 'poi_456',
    title: '蔡澜Pho',
    address: '广州市越秀区建设大马路18号',
    category: '美食;越南菜',
    type: 0,
    location: { lat: 23.1331, lng: 113.2762 },
  };
  const r = adapter.toRestaurant(poi, 'tencent_map');
  assert(r.name === '蔡澜Pho', '餐厅名称应正确');
  assert(r.categories.includes('VIETNAMESE'), '应识别越南菜分类');
  assert(r.location.providerRefs?.[0].externalId === 'poi_456', '应保留 ProviderRef');
}

// ---- 3. TencentMapUriBuilder 生成 search URI ----
{
  const uri = tencentMapUriBuilder.buildSearchUri({ keyword: '羽毛球馆', region: '广州' });
  assert(uri.startsWith('https://apis.map.qq.com/uri/v1/search?'), `search URI 前缀错误: ${uri}`);
  assert(uri.includes(encodeURIComponent('羽毛球馆')), 'keyword 应被 encodeURIComponent 编码');
  assert(uri.includes('referer='), '应包含 referer');
}

// ---- 4. TencentMapUriBuilder 生成 routeplan URI ----
{
  const uri = tencentMapUriBuilder.buildRouteUri({
    from: { latitude: 23.1, longitude: 113.2 },
    to: { latitude: 23.13, longitude: 113.32 },
    mode: 'transit',
  });
  assert(uri.startsWith('https://apis.map.qq.com/uri/v1/routeplan?'), `routeplan URI 前缀错误: ${uri}`);
  assert(uri.includes('to=23.13') && uri.includes('113.32'), `应包含终点经纬度: ${uri}`);
  assert(uri.includes('mode=transit'), '应包含交通方式');
}

// ---- 5. TencentMapUriBuilder 生成 marker URI ----
{
  const uri = tencentMapUriBuilder.buildMarkerUri({
    location: { id: 'l1', name: '广州羽毛球中心', latitude: 23.13, longitude: 113.32 },
  });
  assert(uri.startsWith('https://apis.map.qq.com/uri/v1/marker?'), `marker URI 前缀错误: ${uri}`);
  assert(uri.includes('coord') && uri.includes('23.13') && uri.includes('113.32'), `应包含坐标: ${uri}`);
}

console.log('✅ tencent-map-adapter.test.ts 全部通过');