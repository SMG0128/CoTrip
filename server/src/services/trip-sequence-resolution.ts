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
};

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
    /(?:之后|然后|随后|接着|结束后|参观完|逛完|看完|打完)(?:再|就|去|附近|直接)?(?:吃|吃饭|用餐|去吃饭)/,
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

  return result;
}
