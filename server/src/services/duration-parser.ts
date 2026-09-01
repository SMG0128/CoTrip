// duration-parser.ts
// 确定性时长解析：把自然语言时长表达式解析为 durationMinutes。
//
// 产品不变量：AI 不得把「看三个小时」当作普通 comment / preference 丢掉。
// 本模块是纯函数、无副作用、不依赖当前时钟，供 AI Trip Pipeline 后处理层消费。
//
// 至少支持：
//   - X小时 / X个小时
//   - X分钟
//   - 一个半小时 / 两个半小时 / 半小时
//   - 阿拉伯数字与中文数字（一/两/三…十）

export interface DurationParseResult {
  /** 解析出的时长（分钟）；无法解析时为 undefined */
  durationMinutes?: number;
  /** 是否成功解析出时长 */
  ok: boolean;
}

const CN_DIGITS: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

/** 解析中文数字（0-99 简单场景）与阿拉伯数字 */
function parseNumber(text: string): number | undefined {
  const arabic = text.match(/\d+(?:\.\d+)?/);
  if (arabic) return parseFloat(arabic[0]);
  const cn = text.match(/[零一二两三四五六七八九十]+/);
  if (!cn) return undefined;
  const s = cn[0];
  if (s === '十') return 10;
  if (s.includes('十')) {
    const parts = s.split('十');
    const tens = parts[0] ? CN_DIGITS[parts[0]] : 1;
    const ones = parts[1] ? CN_DIGITS[parts[1]] : 0;
    if (tens === undefined) return undefined;
    return tens * 10 + (ones ?? 0);
  }
  return CN_DIGITS[s];
}

/**
 * 从文本中解析时长。
 *
 * 优先级（按最具体到最宽泛）：
 *   1. X小时X分钟 / X小时 / X个小时
 *   2. X分钟
 *   3. 一个半小时 / 两个半小时 / 半小时
 *
 * 返回 ok=false 表示文本中不包含可解析的时长，调用方不得据此伪造时长。
 */
export function parseDurationMinutes(text: string): DurationParseResult {
  const normalized = text.trim();
  if (!normalized) return { ok: false };

  // 半小时 / 一个半小时 / 两个半小时 / 三个半小时 …
  // 语义：一个半小时 = 1 小时 + 半小时 = 90；两个半小时 = 2 小时 + 半小时 = 150。
  const halfMatch = normalized.match(/([零一二两三四五六七八九十\d]+)?\s*个?\s*半小时/);
  if (halfMatch) {
    const prefix = halfMatch[1];
    if (prefix === undefined || prefix === '') {
      // 纯「半小时」
      return { ok: true, durationMinutes: 30 };
    }
    const n = parseNumber(prefix);
    if (n !== undefined) {
      // N 个半小时 = N 小时 + 半小时 = N*60 + 30
      return { ok: true, durationMinutes: n * 60 + 30 };
    }
  }

  // X小时Y分钟 / X个小时Y分钟
  const hourMinute = normalized.match(
    /(\d+(?:\.\d+)?|[零一二两三四五六七八九十]+)\s*个?小时\s*(?:(\d+(?:\.\d+)?|[零一二两三四五六七八九十]+)\s*分钟?)?/,
  );
  if (hourMinute) {
    const hours = parseNumber(hourMinute[1]);
    if (hours === undefined) return { ok: false };
    let minutes = 0;
    if (hourMinute[2]) {
      const m = parseNumber(hourMinute[2]);
      if (m === undefined) return { ok: false };
      minutes = m;
    }
    return { ok: true, durationMinutes: Math.round(hours * 60) + minutes };
  }

  // X分钟
  const minuteMatch = normalized.match(/(\d+(?:\.\d+)?|[零一二两三四五六七八九十]+)\s*分钟/);
  if (minuteMatch) {
    const m = parseNumber(minuteMatch[1]);
    if (m === undefined) return { ok: false };
    return { ok: true, durationMinutes: Math.round(m) };
  }

  return { ok: false };
}