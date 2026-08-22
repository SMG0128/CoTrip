// 广州地铁本地展示注册表与交通徽章纯函数测试。

import {
  GUANGZHOU_METRO_LINES,
  buildGuangzhouMetroBadgePresentation,
  getContrastTextColor,
  normalizeGuangzhouMetroLineTitle,
} from '../utils/guangzhou-metro';
import {
  COTRIP_TRANSIT_BLUE,
  TRANSIT_BADGE_LIGHT_TEXT,
  buildTransitBadgePresentation,
  normalizeBusLineTitle,
} from '../utils/route-options-ui';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`断言失败: ${message}`);
}

export async function runGuangzhouMetroTests(): Promise<void> {
  const cases: Array<[string, string]> = [
    ['广州地铁1号线', '1'],
    ['地铁1号线', '1'],
    ['1号线', '1'],
    ['地铁10号线', '10'],
    ['地铁11号线', '11'],
    ['地铁12号线', '12'],
    ['地铁3号线北延段', '3'],
    ['14号线知识城支线', '14'],
    ['知识城线', '14'],
    ['14号线知识城线', '14'],
    ['12号线西段', '12'],
    ['APM线', 'APM'],
    ['地铁APM线', 'APM'],
    ['珠江新城APM线', 'APM'],
    ['珠江新城旅客自动输送系统', 'APM'],
    ['广佛线', 'GF'],
    ['广佛地铁', 'GF'],
    ['Guangfo Line', 'GF'],
  ];
  cases.forEach(([raw, expected]) => {
    assert(normalizeGuangzhouMetroLineTitle(raw) === expected, `${raw} 应归一为 ${expected}`);
  });

  const falsePositives = [
    'unknown',
    '深圳地铁1号线',
    '佛山地铁2号线',
    '公交1号线',
    '15号线',
    '16号线',
    '11号线公交',
    '1号线路',
  ];
  falsePositives.forEach((raw) => {
    assert(normalizeGuangzhouMetroLineTitle(raw) === null, `${raw} 必须安全回退 null`);
  });
  assert(normalizeGuangzhouMetroLineTitle('地铁11号线') === '11', '11 不得被误别为 1');

  const expectedColors: Record<string, string> = {
    '1': '#F3D03E',
    '2': '#00629B',
    '10': '#7389B2',
    '11': '#F5BB17',
    '12': '#435428',
    '18': '#0047BA',
    '21': '#201747',
    '22': '#CD5228',
    APM: '#00B5E2',
    GF: '#C4D600',
  };
  Object.keys(expectedColors).forEach((key) => {
    assert(
      GUANGZHOU_METRO_LINES[key as keyof typeof GUANGZHOU_METRO_LINES].background ===
        expectedColors[key],
      `${key} 线颜色必须与本地注册表一致`
    );
  });
  Object.entries(GUANGZHOU_METRO_LINES).forEach(([key, value]) => {
    assert(/^#[0-9A-F]{6}$/.test(value.background), `${key} 必须使用 #RRGGBB 背景色`);
  });

  assert(getContrastTextColor('#F3D03E') === '#172033', '1 号线黄底使用深色文字');
  assert(getContrastTextColor('#00629B') === '#FFFFFF', '2 号线蓝底使用白字');
  assert(getContrastTextColor('#F5BB17') === '#172033', '11 号线金色底使用深色文字');
  assert(getContrastTextColor('#201747') === '#FFFFFF', '21 号线深蓝底使用白字');
  assert(getContrastTextColor('#00B5E2') === '#172033', 'APM 青色底使用深色文字');

  const line1 = buildGuangzhouMetroBadgePresentation('地铁1号线');
  const line11 = buildGuangzhouMetroBadgePresentation('地铁11号线');
  const apm = buildGuangzhouMetroBadgePresentation('地铁APM线');
  const guangfo = buildGuangzhouMetroBadgePresentation('广佛线');
  assert(line1?.text === '1' && !/[号线地铁]/.test(line1.text), '1 号线 badge 只显示 1');
  assert(line11?.text === '11' && !/[号线地铁]/.test(line11.text), '11 号线 badge 只显示 11');
  assert(apm?.text === 'APM', 'APM badge 显示 APM');
  assert(guangfo?.text === '广佛', '广佛 badge 对中文用户显示「广佛」');

  assert(normalizeBusLineTitle('55路') === '55', '55路 → 55');
  assert(normalizeBusLineTitle('B3路') === 'B3', 'B3路 → B3');
  assert(normalizeBusLineTitle('810路') === '810', '810路 → 810');
  assert(normalizeBusLineTitle('大学城专线1') === '大学城专线1', '特殊专线名不过度缩写');

  const bus = buildTransitBadgePresentation({ lineTitle: 'B3路', transportMode: 'BUS' });
  assert(bus?.text === 'B3', '公交 badge 必须使用 Provider 线路名');
  assert(
    bus?.backgroundColor === COTRIP_TRANSIT_BLUE &&
      bus.foregroundColor === TRANSIT_BADGE_LIGHT_TEXT,
    '公交 badge 使用 CoTrip 蓝底白字'
  );
  assert(
    buildTransitBadgePresentation({ lineTitle: undefined, transportMode: 'BUS' }) === null,
    '公交线路名缺失时不得编造 badge'
  );

  const guangzhouMetro = buildTransitBadgePresentation(
    { lineTitle: '地铁1号线', transportMode: 'METRO' },
    { city: '广州市' }
  );
  const otherCityMetro = buildTransitBadgePresentation(
    { lineTitle: '地铁1号线', transportMode: 'METRO' },
    { city: '深圳市' }
  );
  assert(
    guangzhouMetro?.source === 'LOCAL_GUANGZHOU' && guangzhouMetro.backgroundColor === '#F3D03E',
    '只有广州上下文才应使用本地线色'
  );
  assert(
    otherCityMetro?.source === 'SEMANTIC' && otherCityMetro.backgroundColor === COTRIP_TRANSIT_BLUE,
    '其他城市的同名线路必须回退通用地铁样式'
  );

  console.log('✅ guangzhou-metro.test.ts 全部通过');
}
