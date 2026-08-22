// Guangzhou Metro compact-badge presentation metadata.
//
// This registry intentionally stores local Guangzhou Metro presentation metadata.
// It is not Tencent Provider data and must never be written back to route DTOs.
// Update it only when Guangzhou Metro opens, renames, or rebrands lines that CoTrip uses.
// Runtime network dependency: none.

export const GUANGZHOU_METRO_LINES = {
  '1': { background: '#F3D03E' },
  '2': { background: '#00629B' },
  '3': { background: '#ECA154' },
  '4': { background: '#00843D' },
  '5': { background: '#C5003E' },
  '6': { background: '#80225F' },
  '7': { background: '#97D700' },
  '8': { background: '#008C95' },
  '9': { background: '#71CC98' },
  '10': { background: '#7389B2' },
  '11': { background: '#F5BB17' },
  '12': { background: '#435428' },
  '13': { background: '#8E8C13' },
  '14': { background: '#81312F' },
  '18': { background: '#0047BA' },
  '21': { background: '#201747' },
  '22': { background: '#CD5228' },
  APM: { background: '#00B5E2' },
  GF: { background: '#C4D600' },
} as const;

export type GuangzhouMetroLineKey = keyof typeof GUANGZHOU_METRO_LINES;

export interface GuangzhouMetroBadgePresentation {
  key: GuangzhouMetroLineKey;
  text: string;
  backgroundColor: string;
  foregroundColor: '#FFFFFF' | '#172033';
}

const SUPPORTED_NUMBERED_LINES = new Set<GuangzhouMetroLineKey>([
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
  '13',
  '14',
  '18',
  '21',
  '22',
]);

/** Conservative, presentation-only normalization of known Guangzhou rail titles. */
export function normalizeGuangzhouMetroLineTitle(
  rawTitle: string
): GuangzhouMetroLineKey | null {
  const compact = rawTitle.trim().replace(/\s+/g, '');
  if (!compact) return null;

  if (
    /^(?:(?:广州地铁|地铁)?APM线|珠江新城APM线|珠江新城旅客自动输送系统)$/i.test(compact)
  ) {
    return 'APM';
  }

  if (/^(?:(?:广州地铁|地铁)?广佛(?:线|地铁)|GuangfoLine)$/i.test(compact)) {
    return 'GF';
  }

  if (/^知识城线$/.test(compact)) return '14';

  const numbered = compact.match(
    /^(?:广州地铁|地铁)?(\d{1,2})号线(?:北延段|支线|知识城支线|知识城线|西段|东段)?$/
  );
  if (!numbered) return null;
  const key = numbered[1] as GuangzhouMetroLineKey;
  return SUPPORTED_NUMBERED_LINES.has(key) ? key : null;
}

function channelToLinear(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const red = parseInt(hex.slice(1, 3), 16);
  const green = parseInt(hex.slice(3, 5), 16);
  const blue = parseInt(hex.slice(5, 7), 16);
  return (
    0.2126 * channelToLinear(red) +
    0.7152 * channelToLinear(green) +
    0.0722 * channelToLinear(blue)
  );
}

/** Selects the higher-contrast reviewed CoTrip light/dark foreground without changing the line color. */
export function getContrastTextColor(background: string): '#FFFFFF' | '#172033' {
  if (!/^#[0-9A-F]{6}$/i.test(background)) return '#172033';
  const backgroundLuminance = relativeLuminance(background);
  const lightContrast = 1.05 / (backgroundLuminance + 0.05);
  const darkLuminance = relativeLuminance('#172033');
  const darkContrast = (backgroundLuminance + 0.05) / (darkLuminance + 0.05);
  return lightContrast > darkContrast ? '#FFFFFF' : '#172033';
}

export function buildGuangzhouMetroBadgePresentation(
  rawTitle: string
): GuangzhouMetroBadgePresentation | null {
  const key = normalizeGuangzhouMetroLineTitle(rawTitle);
  if (!key) return null;
  const backgroundColor = GUANGZHOU_METRO_LINES[key].background;
  return {
    key,
    text: key === 'GF' ? '广佛' : key,
    backgroundColor,
    foregroundColor: getContrastTextColor(backgroundColor),
  };
}
