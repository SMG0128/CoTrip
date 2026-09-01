// trip-sequence-resolution.ts
// 确定性活动先后关系解析（D 节）。
//
// 用户表达「去完广图我希望可以去吃泰国菜」「参观省博后吃越南菜」时，AI 应产出两个活动：
//   Activity A: 广州图书馆看书 / 参观广东省博物馆
//   Activity B: 吃泰国菜 / 吃越南菜
// 约束：Activity B AFTER Activity A，且 locationConstraint = near_previous_activity。
//
// 本模块在 AI 返回 snapshot 后做确定性后处理：
//   - 标题法：识别「去完X后去Y」「X之后去Y」等先后关系
//   - 评论法：识别「参观省博后吃越南菜」「之后附近吃越南菜」等省略地点的先后关系
//   - 为后续活动写入 afterActivityId / dependsOn / sequenceConstraint
//   - 为后续活动写入 locationConstraint = near_previous_activity
//
// 纯函数、无副作用、不依赖当前时钟。

import { TripPlanEvent } from '../types/trip-plan';

/** 活动先后关系约束（可选、向后兼容，不破坏既有 schema） */
export interface SequenceConstraint {
  /** 本活动必须发生在该活动之后 */
  afterActivityId: string;
  /** 位置约束：near_previous_activity = 以前一活动真实坐标为中心搜索 */
  locationConstraint: 'near_previous_activity';
}

/** 扩展后的活动：在既有 TripPlanEvent 基础上附加可选 sequenceConstraint 字段 */
export type SequencedTripPlanEvent = TripPlanEvent & {
  sequenceConstraint?: SequenceConstraint;
};

/** 常见地点别名：把简称映射到全称，用于先后关系匹配（如「广图」→「广州图书馆」）。
 * 仅保留极少数高置信缩写，其余交给城市上下文 + 腾讯 POI 消歧。 */
const LOCATION_ALIASES: Record<string, string> = {
  广图: '广州图书馆',
  广图新馆: '广州图书馆',
  省图: '广东省立中山图书馆',
  省博: '广东省博物馆',
  省博物馆: '广东省博物馆',
  粤博: '广东省博物馆',
};

/** 把地点短语归一化为全称（存在别名时），用于意图/先后关系匹配。 */
export function normalizePlaceKeyword(keyword: string): string {
  return LOCATION_ALIASES[keyword] ?? keyword;
}

/** 常见地点后缀：剥离后可匹配评论里的简称（「越秀公园」→「越秀」）。通用规则，非城市特例。 */
const PLACE_SUFFIXES = [
  '公园', '图书馆', '博物馆', '科技馆', '美术馆', '体育馆', '纪念馆',
  '展览馆', '广场', '中心', '大学', '学院', '医院', '机场', '车站',
  '码头', '商场', '大厦', '酒店', '剧院', '影城', '景区', '山庄',
];

/** 生成地点短语的可能书写形式：全称、别名、剥离通用后缀后的简称。
 * 通用规则：若某个别名对应的全称包含 keyword（如 keyword=省博物馆，全称=广东省博物馆），
 * 该别名（省博/粤博）也可能出现在评论里，一并纳入候选。 */
export function placeMentionCandidates(keyword: string): string[] {
  const candidates = [keyword];
  for (const [alias, full] of Object.entries(LOCATION_ALIASES)) {
    if (full === keyword) candidates.push(alias);
    if (alias === keyword) candidates.push(full);
    // 简称兜底：全称包含 keyword 时，指向同一地点的别名（更短写法）也纳入候选
    if (full.includes(keyword) && alias !== keyword) candidates.push(alias);
  }
  for (const suffix of PLACE_SUFFIXES) {
    if (keyword.endsWith(suffix) && keyword.length - suffix.length >= 2) {
      candidates.push(keyword.slice(0, -suffix.length));
    }
  }
  return candidates;
}

/** 在评论原文中查找地点短语的首次出现位置（含别名/后缀简称）。找不到返回 -1。 */
export function findPlaceMentionIndex(commentText: string, keyword: string): number {
  if (!commentText) return -1;
  let best = -1;
  for (const candidate of placeMentionCandidates(keyword)) {
    if (candidate.length < 2) continue;
    const index = commentText.indexOf(candidate);
    if (index >= 0 && (best < 0 || index < best)) best = index;
  }
  return best;
}

/** 从活动标题中提取「去完X / 去X之后」的地点关键词。
 * 地点名在「去完」之后、动作动词（吃/看/打/玩/逛/喝/买…）之前。 */
function extractPreviousActivityKeyword(title: string): string | undefined {
  const m = title.match(/去完\s*([\u4e00-\u9fa5A-Za-z0-9]{2,8}?)(?:吃|看|打|玩|逛|喝|买|去|到|参加|体验|参观|游览|之后|然后|再|就)?/);
  return m ? m[1] : undefined;
}

/** 判断前置活动标题是否与关键词匹配（含别名归一化） */
function titleMatchesKeyword(priorTitle: string, keyword: string): boolean {
  if (priorTitle.includes(keyword)) return true;
  const full = LOCATION_ALIASES[keyword];
  if (full && priorTitle.includes(full)) return true;
  // 反向：关键词是简称，前置活动含全称
  for (const [alias, fullName] of Object.entries(LOCATION_ALIASES)) {
    if (keyword === fullName && priorTitle.includes(alias)) return true;
  }
  return false;
}

/** 是否为餐饮类标题（吃/菜/餐/饭） */
function isMealTitle(title: string): boolean {
  return /吃|菜|餐|饭/.test(title);
}

/** 是否属于移动/交通类标题（「前往X」「坐地铁X」等） */
function isTransportTitle(title: string): boolean {
  return /^(前往|去往|坐|乘|搭|打车|地铁|公交|高铁|火车|飞机|导航)/.test(title);
}

/**
 * 从评论原文解析先后关系（标题法覆盖不到的省略地点场景）：
 *
 * 模式 A（显式地点）：「参观省博后吃越南菜」「省博之后吃越南菜」
 *   → 地点词 + (后|之后|然后) + 吃 → 找到标题含该地点的前置活动。
 *
 * 模式 B（省略地点）：「之后附近吃越南菜」「然后吃个饭」
 *   → 序列标记 + 吃 → 链接到紧邻的前一个非餐饮、非交通活动。
 *
 * 只在目标餐饮活动尚无 sequenceConstraint 时生效，绝不覆盖标题法结果。
 */
function resolveSequenceFromComment(
  result: SequencedTripPlanEvent[],
  commentText: string,
): void {
  if (!commentText) return;

  // 模式 A：显式地点 + 序列标记 + 吃
  const explicitMatch = commentText.match(
    /(?:参观|游览|逛|玩|看|去)?([\u4e00-\u9fa5A-Za-z0-9]{2,12}?)(?:后|之后|然后)(?:再|就|去|附近|直接|找个|找家)?(?:吃|吃饭|用餐|去吃饭)/,
  );
  if (explicitMatch) {
    const placeKeyword = explicitMatch[1].replace(/[，。、,；;：:\s]+$/g, '');
    // 找到标题含该地点的前置活动（优先非餐饮、非交通）
    const priorIndex = result.findIndex(
      (e, idx) =>
        idx < result.length &&
        !isMealTitle(e.title) &&
        !isTransportTitle(e.title) &&
        titleMatchesKeyword(e.title, placeKeyword),
    );
    if (priorIndex >= 0) {
      // 链接到该前置活动之后的第一个餐饮活动
      for (let i = priorIndex + 1; i < result.length; i += 1) {
        if (result[i].sequenceConstraint) continue;
        if (!isMealTitle(result[i].title)) continue;
        result[i].sequenceConstraint = {
          afterActivityId: result[priorIndex].id,
          locationConstraint: 'near_previous_activity',
        };
        break;
      }
      return;
    }
  }

  // 模式 B：省略地点 + 序列标记 + 吃 → 链接到紧邻的前一个非餐饮、非交通活动
  const implicitMatch = commentText.match(
    /(?:(?:之后|然后|随后|接着|结束后|参观完|逛完|看完|打完)(?:再|就|去|附近|直接)?|(?:晚上|中午|下午|早上|上午)?(?:附近|就近))(?:吃|吃饭|用餐|去吃饭)/,
  );
  if (!implicitMatch) return;

  for (let i = 0; i < result.length; i += 1) {
    if (result[i].sequenceConstraint) continue;
    if (!isMealTitle(result[i].title)) continue;
    for (let j = i - 1; j >= 0; j -= 1) {
      if (isMealTitle(result[j].title) || isTransportTitle(result[j].title)) continue;
      result[i].sequenceConstraint = {
        afterActivityId: result[j].id,
        locationConstraint: 'near_previous_activity',
      };
      break;
    }
  }
}

/**
 * 解析活动先后关系。
 *
 * 策略：
 *   1. 标题法：若某事件标题含「去完X」且存在一个标题含 X 的前置活动，
 *      则把该事件标记为 AFTER 那个前置活动，并设置 near_previous_activity。
 *   2. 评论法：commentText 含「X后吃Y」「之后吃Y」等省略地点的序列语义时，
 *      把餐饮活动链接到前置活动（用于真实腾讯坐标附近的 nearby 搜索）。
 *
 * 返回新的事件数组（不修改入参）。
 */
export function resolveSequenceConstraints(
  events: TripPlanEvent[],
  commentText?: string,
): SequencedTripPlanEvent[] {
  const result: SequencedTripPlanEvent[] = events.map((e) => ({ ...e }));

  // 1. 标题法
  for (let i = 0; i < result.length; i += 1) {
    const current = result[i];
    const keyword = extractPreviousActivityKeyword(current.title);
    if (!keyword) continue;

    // 在更早的活动中寻找包含该关键词（含别名）的前置活动
    for (let j = 0; j < i; j += 1) {
      const prior = result[j];
      if (titleMatchesKeyword(prior.title, keyword)) {
        current.sequenceConstraint = {
          afterActivityId: prior.id,
          locationConstraint: 'near_previous_activity',
        };
        break;
      }
    }
  }

  // 2. 评论法（补充标题法覆盖不到的场景）
  if (commentText) {
    resolveSequenceFromComment(result, commentText);
  }

  // 3. 通用顺序地点链接（compound sequence：A → B → C）
  //    从评论中按出现顺序提取每个活动的地点提及，若提及顺序与活动顺序一致
  //    （用户在评论里就是按 1→2→3 的顺序表达的），则把相邻活动链接成先后关系。
  //    只处理尚无 sequenceConstraint 的活动，绝不覆盖标题法/评论法结果。
  //    例如「看一个小时书我想去粤博参观一下再去越秀」→ 图书馆 → 粤博 → 越秀。
  if (commentText) {
    resolveSequentialPlacesFromComment(result, commentText);
  }

  return result;
}

/**
 * 从活动标题提取用于匹配评论的地点关键词。
 * 与 post-processor 的 extractPlaceQuery 规则保持一致：餐饮/交通标题不产生地点提及。
 */
function eventPlaceKeyword(event: SequencedTripPlanEvent): string | undefined {
  const title = event.title;
  if (!title) return undefined;
  if (isMealTitle(title)) return undefined;
  if (isTransportTitle(title)) return undefined;
  // 剥离动作词后取地点短语（「广州图书馆看书」→「广州图书馆」）
  let t = title.trim().replace(/^(?:去参观|去游览|去游玩|去完|前往|参观|游览|游玩|体验|逛|看|到|在|去|直接去)/, '');
  const verbIndex = t.search(
    /(?:办理入住|入住|住宿|休息|看|读|玩|打|吃|喝|买|购物|逛街|参观|游览|体验|听|唱|跳|拍|打卡|运动|游泳|跑步|骑行|散步|爬山|放风筝|候车|乘车|换乘)/,
  );
  if (verbIndex > 0) t = t.slice(0, verbIndex);
  t = t.trim();
  if (!/^[\u4e00-\u9fa5A-Za-z0-9]{2,12}$/.test(t)) return undefined;
  return t;
}

/** 通用顺序地点链接：评论中提及顺序与活动顺序一致时，链接相邻活动。 */
function resolveSequentialPlacesFromComment(
  result: SequencedTripPlanEvent[],
  commentText: string,
): void {
  if (!commentText || result.length < 2) return;

  // 每个活动 → 其地点关键词在评论中的首次出现位置
  const mentions: { event: SequencedTripPlanEvent; index: number }[] = [];
  for (const event of result) {
    if (event.sequenceConstraint) continue;
    const keyword = eventPlaceKeyword(event);
    if (!keyword) continue;
    const index = findPlaceMentionIndex(commentText, keyword);
    if (index < 0) continue;
    mentions.push({ event, index });
  }
  if (mentions.length < 2) return;

  // 按评论位置排序；若排序后仍保持活动原始相对顺序，才建立先后关系
  const sorted = [...mentions].sort((a, b) => a.index - b.index);
  for (let k = 1; k < sorted.length; k += 1) {
    const prior = sorted[k - 1];
    const next = sorted[k];
    // 原始相对顺序：prior 必须在 next 之前（位置索引递增）
    const priorOrder = result.indexOf(prior.event);
    const nextOrder = result.indexOf(next.event);
    if (priorOrder >= nextOrder) return; // 顺序不一致 → 不强行链接
    next.event.sequenceConstraint = {
      afterActivityId: prior.event.id,
      locationConstraint: 'near_previous_activity',
    };
  }
}
