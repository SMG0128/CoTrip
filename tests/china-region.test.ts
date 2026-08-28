// tests/china-region.test.ts
// 国内省市区选择器纯函数测试：
// - 数据完整性：31 省、广东 21 市、直辖市归并（无「市辖区/县」裸名）
// - 选项构建：区列首位恒为「不限」；越界省/市安全回退
// - 索引解析：区列索引 0 → district 空串（区不限）；索引 1 → 首个真实区
// - 展示文案：直辖市去重、区不限仅到市级

import {
  CHINA_REGION,
  DISTRICT_UNLIMITED,
  buildRegionColumns,
  cityOptions,
  districtOptions,
  provinceOptions,
  regionDisplayText,
  resolveRegionIndices,
} from '../utils/china-region';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

// ---- 1. 数据完整性 ----
{
  assert(CHINA_REGION.length === 31, '应覆盖 31 个省级行政区');
  assert(provinceOptions()[0] === '北京市', '首省为北京');
  const guangdong = CHINA_REGION.find((p) => p.name === '广东省');
  assert(!!guangdong && guangdong.cities.length === 21, '广东应有 21 个地级市');
  const bareNames = CHINA_REGION.flatMap((p) => p.cities.map((c) => c.name)).filter(
    (name) => name === '市辖区' || name === '县',
  );
  assert(bareNames.length === 0, '直辖市的市辖区/县应并入直辖市名');
  const beijing = CHINA_REGION.find((p) => p.name === '北京市');
  assert(!!beijing && beijing.cities.length === 1 && beijing.cities[0].districts.length > 0, '北京应归并为单一市条目且含区');
}

// ---- 2. 选项构建 ----
{
  assert(cityOptions(0)[0] === '北京市', '北京省级下市级为「北京市」');
  assert(cityOptions(-1).length === 0 && cityOptions(999).length === 0, '市级越界应返回空');
  const districts = districtOptions(0, 0);
  assert(districts[0] === DISTRICT_UNLIMITED, '区列首位应为「不限」');
  assert(districts.includes('东城区'), '北京区列应含东城区');
  assert(
    JSON.stringify(districtOptions(0, 999)) === JSON.stringify([DISTRICT_UNLIMITED]),
    '区级越界应仅返回「不限」',
  );
  const columns = buildRegionColumns(18, 0);
  assert(columns.length === 3 && columns[0].length === 31, '三列结构且省列 31 项');
}

// ---- 3. 索引解析 ----
{
  const unlimited = resolveRegionIndices([18, 0, 0]);
  assert(!!unlimited && unlimited.province === '广东省' && unlimited.city === '广州市' && unlimited.district === '', '区列索引 0 应解析为区不限');
  const first = resolveRegionIndices([18, 0, 1]);
  assert(!!first && first.district === '荔湾区', '区列索引 1 应为广州首个区');
  assert(resolveRegionIndices([999, 0, 0]) === null, '省越界应返回 null');
  assert(resolveRegionIndices([0, 999, 0]) === null, '市越界应返回 null');
}

// ---- 4. 展示文案 ----
{
  assert(regionDisplayText({ province: '广东省', city: '广州市', district: '天河区' }) === '广东省 广州市 天河区', '完整三级文案');
  assert(regionDisplayText({ province: '北京市', city: '北京市', district: '朝阳区' }) === '北京市 朝阳区', '直辖市应去重省市名');
  assert(regionDisplayText({ province: '广东省', city: '广州市', district: '' }) === '广东省 广州市', '区不限文案仅到市级');
}

console.log('✅ china-region.test.ts 全部通过');
