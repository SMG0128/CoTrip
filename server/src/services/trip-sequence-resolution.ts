// trip-sequence-resolution.ts
// 确定性活动先后关系解析（D 节）。
//
// 用户表达「去完广图我希望可以去吃泰国菜」时，AI 应产出两个活动：
//   Activity A: 广州图书馆看书
//   Activity B: 吃泰国菜
// 约束：Activity B AFTER Activity A，且 locationConstraint = near_previous_activity。
//
// 本模块在 AI 返回 snapshot 后做确定性后处理：
//   - 识别「去完X后去Y」「X之后去Y」等先后关系
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

/** 常见地点别名：把简称映射到全称，用于先后关系匹配（如「广图」→「广州图书馆」） */
const LOCATION_ALIASES: Record<string, string> = {
  广图: '广州图书馆',
  广图新馆: '广州图书馆',
  省图: '广东省立中山图书馆',
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

/**
 * 解析活动先后关系。
 *
 * 策略：遍历事件，若某事件标题含「去完X」且存在一个标题含 X 的前置活动，
 * 则把该事件标记为 AFTER 那个前置活动，并设置 near_previous_activity。
 *
 * 返回新的事件数组（不修改入参）。
 */
export function resolveSequenceConstraints(
  events: TripPlanEvent[],
): SequencedTripPlanEvent[] {
  const result: SequencedTripPlanEvent[] = events.map((e) => ({ ...e }));

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

  return result;
}