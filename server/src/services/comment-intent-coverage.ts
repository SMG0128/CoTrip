// comment-intent-coverage.ts
// 原子意图覆盖（C/D 节）：把一条评论的可计划内容拆成 atomic intents，
// 逐条判断当前计划是否覆盖，并导出整条评论的纳入状态。
//
// 不变量：
//   - 不再用「评论是否影响了至少一个 event」判断整条评论已完成；
//     一条评论 3 个意图只实现 2 个 → 显示「部分纳入 2/3」，而不是「已纳入计划」。
//   - 意图拆分是确定性的、规则驱动的，复用项目已有的预处理能力
//     （地点短语提取 extractPlaceQuery / 餐饮关键词 extractFoodKeyword / 时长解析
//     parseDurationMinutes / 地点别名与后缀归一化）。
//   - 绝不针对具体城市 / 具体样例写 special-case；规则全部通用。
//   - coverage 只反映「当前计划是否覆盖」，不伪造 REJECTED/CONFLICT 判定；
//     无法确定具体状态时使用 UNRESOLVED（0 个 PLANNED 时评论绝不为 INCORPORATED）。
//
// 本模块是纯函数、无副作用，便于确定性测试。

import { Comment } from '../types/comment';
import { TripPlan, TripPlanEvent } from '../types/trip-plan';
import { parseDurationMinutes } from './duration-parser';
import {
  extractFoodKeyword,
  extractPlaceQuery,
} from './trip-plan-post-processor';
import {
  normalizePlaceKeyword,
  placeMentionCandidates,
} from './trip-sequence-resolution';

export type IntentKind = 'ACTIVITY' | 'PLACE' | 'MEAL';
export type IntentCoverageStatus = 'PLANNED' | 'UNRESOLVED' | 'REJECTED' | 'CONFLICT' | 'PENDING';
export type IncorporationStatus = 'INCORPORATED' | 'PARTIALLY_INCORPORATED' | 'UNRESOLVED';

export interface AtomicIntent {
  id: string;
  kind: IntentKind;
  /** 归一化后的地点关键词（如「粤博」→「广东省博物馆」） */
  location?: string;
  /** 动作词（看 / 参观 / 打…） */
  action?: string;
  durationMinutes?: number;
  foodKeyword?: string;
  /** 顺序链：本意图在该意图之后（如 图书馆 → 粤博 → 越秀） */
  afterIntentId?: string;
}

export interface IntentCoverageEntry {
  intent: AtomicIntent;
  status: IntentCoverageStatus;
  /** 匹配到的计划事件 id（PLANNED 时存在） */
  matchedEventId?: string;
}

export interface CommentIntentCoverage {
  intents: AtomicIntent[];
  entries: IntentCoverageEntry[];
  /** 全部 PLANNED → INCORPORATED；部分 → PARTIALLY_INCORPORATED；0 个 → UNRESOLVED */
  incorporation: IncorporationStatus;
  plannedCount: number;
  totalCount: number;
}

const SEQUENCE_SPLITTER =
  /(?:然后|之后|随后|接着|再去|再(?!见)|后(?!面|续|勤|台|边|方)|，|。|；|;|、|我想去|想去|接下来|先)/;

/** 可附着到上一地点的「停留类」动作词；参观/游览/逛 等视为「前往地点」动作 */
const STAY_VERBS = /看|读|阅读|打|玩|休息|散步|运动|游泳|跑步|骑行|购物|买|逛店|喝|吃/;

/**
 * 把一条评论拆成 atomic intents。
 *
 * 例：「十点到广州图书馆，看一个小时书，然后去粤博参观一下再去越秀」
 *   → i1 { ACTIVITY, 广州图书馆, 看, 60 }
 *   → i2 { PLACE, 广东省博物馆, after: i1 }
 *   → i3 { PLACE, 越秀公园, after: i2 }
 */
export function splitCommentIntoAtomicIntents(text: string): AtomicIntent[] {
  const cleaned = (text ?? '').trim();
  if (!cleaned) return [];

  const segments = cleaned
    .split(SEQUENCE_SPLITTER)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const intents: AtomicIntent[] = [];
  let lastPlaceIntentId: string | undefined;

  for (const segment of segments) {
    // 餐饮意图：菜系关键词（吃粤菜 / 附近吃饭 / 找餐厅…）
    const foodKeyword = extractFoodKeyword(segment);
    if (foodKeyword) {
      const intent: AtomicIntent = {
        id: intentId(intents.length),
        kind: 'MEAL',
        foodKeyword,
        ...(lastPlaceIntentId ? { afterIntentId: lastPlaceIntentId } : {}),
      };
      intents.push(intent);
      continue;
    }

    const place = extractMentionedPlace(segment);
    const duration = parseDurationMinutes(segment);
    const action = extractActionVerb(segment);

    if (place) {
      const intent: AtomicIntent = {
        id: intentId(intents.length),
        kind: duration.ok && duration.durationMinutes !== undefined ? 'ACTIVITY' : 'PLACE',
        location: place,
        ...(action ? { action } : {}),
        ...(duration.ok && duration.durationMinutes !== undefined
          ? { durationMinutes: duration.durationMinutes }
          : {}),
        ...(lastPlaceIntentId ? { afterIntentId: lastPlaceIntentId } : {}),
      };
      intents.push(intent);
      lastPlaceIntentId = intent.id;
      continue;
    }

    // 无地点但有动作+时长（「看一个小时书」）：附着到上一个地点意图
    if (duration.ok && action && !lastPlaceIntentId) continue;
    if (duration.ok && action && lastPlaceIntentId) {
      const last = intents[intents.length - 1];
      if (last && (last.kind === 'PLACE' || last.kind === 'ACTIVITY')) {
        last.kind = 'ACTIVITY';
        last.action = last.action ?? action;
        if (last.durationMinutes === undefined && duration.durationMinutes !== undefined) {
          last.durationMinutes = duration.durationMinutes;
        }
      }
    }
  }

  return intents;
}

function intentId(index: number): string {
  return `i${index + 1}`;
}

/** 从评论片段提取地点关键词（通用规则，非城市特例） */
function extractMentionedPlace(segment: string): string | undefined {
  let s = segment.trim();
  // 语气词 / 时间前缀
  s = s.replace(/^(?:我想|我要|我们|就|直接|先去|先)/, '');
  s = s.replace(/^(?:早上|上午|中午|下午|晚上|清晨|傍晚)\s*[一二两三四五六七八九十\d\s]*点(?:半)?(?:钟)?(?:到|去|在|开始)?/, '');
  s = s.replace(/^[一二两三四五六七八九十\d\s]*点(?:半)?(?:钟)?(?:到|去|在|开始)?/, '');
  if (!s) return undefined;

  // 纯动作短语（「看一个小时书」「打羽毛球」）不是地点：
  // 以非位移动作动词开头（看/读/打/玩/喝/吃/休息…）视为活动短语而非地点；
  // 只有位移动词（去/到/在/参观/游览/逛…）才表示后面跟着地点。
  if (/^(?:看|读|阅读|打|玩|喝|吃|休息|散步|运动|游泳|跑步|骑行|买|购物|逛街)/.test(s)) {
    return undefined;
  }

  // 剥离前导动词
  const stripped = s.replace(/^(?:去参观|去游览|去游玩|去完|前往|参观|游览|游玩|体验|逛|看|到|在|去|直接去)/, '');
  // 在动作动词处截断（「粤博参观一下」→「粤博」）
  const verbIndex = stripped.search(
    /(?:办理入住|入住|住宿|休息|看|读|玩|打|吃|喝|买|购物|逛街|参观|游览|体验|听|唱|跳|拍|打卡|运动|游泳|跑步|骑行|散步|爬山|放风筝|候车|乘车|换乘|一下)/,
  );
  const t = (verbIndex > 0 ? stripped.slice(0, verbIndex) : stripped).trim();
  if (!/^[\u4e00-\u9fa5A-Za-z0-9]{2,12}$/.test(t)) return undefined;
  return normalizePlaceKeyword(t);
}

/** 从评论片段提取动作词 */
function extractActionVerb(segment: string): string | undefined {
  const m = segment.match(/(看|读|阅读|打|玩|逛|参观|游览|体验|休息|散步|喝|买|购物|打卡|运动|游泳|跑步|骑行)/);
  return m ? m[1] : undefined;
}

/**
 * 计算每条意图相对当前计划的覆盖情况。
 * plan 缺省（尚无计划）时全部 PENDING；有计划时逐条匹配。
 */
export function computeIntentCoverage(
  intents: AtomicIntent[],
  plan: TripPlan | undefined,
): CommentIntentCoverage | undefined {
  if (intents.length === 0) return undefined;

  const entries: IntentCoverageEntry[] = intents.map((intent) => {
    if (!plan) {
      return { intent, status: 'PENDING' };
    }
    const matched = findMatchedEvent(intent, plan.events);
    if (matched) {
      return { intent, status: 'PLANNED', matchedEventId: matched.id };
    }
    return { intent, status: 'UNRESOLVED' };
  });

  const plannedCount = entries.filter((e) => e.status === 'PLANNED').length;
  const incorporation: IncorporationStatus =
    plannedCount === entries.length
      ? 'INCORPORATED'
      : plannedCount === 0
        ? 'UNRESOLVED'
        : 'PARTIALLY_INCORPORATED';

  return {
    intents,
    entries,
    incorporation,
    plannedCount,
    totalCount: entries.length,
  };
}

/** 在计划事件中查找匹配该意图的事件 */
function findMatchedEvent(intent: AtomicIntent, events: TripPlanEvent[]): TripPlanEvent | undefined {
  if (intent.kind === 'MEAL') {
    return events.find((event) => eventMatchesMeal(event, intent.foodKeyword ?? ''));
  }
  const location = intent.location;
  if (!location) return undefined;
  return events.find((event) => eventMatchesPlace(event, location));
}

/** 地点类意图 vs 计划事件（含别名 / 后缀简称 / 标题包含） */
function eventMatchesPlace(event: TripPlanEvent, locationKeyword: string): boolean {
  const names: string[] = [];
  if (event.location?.name) names.push(event.location.name);
  if (event.title) names.push(event.title);

  const locCandidates = placeMentionCandidates(locationKeyword);
  for (const name of names) {
    for (const loc of locCandidates) {
      if (loc.length >= 2 && name.includes(loc)) return true;
      const nameCandidates = placeMentionCandidates(name);
      for (const nc of nameCandidates) {
        if (nc.length >= 2 && loc.includes(nc)) return true;
      }
    }
  }
  return false;
}

/** 餐饮类意图 vs 计划事件（事件必须是餐饮意图；菜系词或餐厅名匹配） */
function eventMatchesMeal(event: TripPlanEvent, foodKeyword: string): boolean {
  const isMealEvent =
    event.type === 'DINING' || /吃|菜|餐|饭/.test(event.title ?? '');
  if (!isMealEvent) return false;
  const names = [
    event.restaurant?.name,
    event.title,
  ].filter((name): name is string => typeof name === 'string');
  if (foodKeyword === '餐厅') {
    // 通用「吃饭 / 找餐厅」意图：任何餐饮活动都算覆盖
    return true;
  }
  return names.some((name) => name.includes(foodKeyword));
}

/**
 * 把原子意图覆盖投影到评论上（读取时投影，始终与最新计划一致）：
 *   - 全部 PLANNED → aiStatus = accepted（已纳入计划）
 *   - 部分 PLANNED → aiStatus = partially_incorporated（部分纳入）
 *   - 0 个 PLANNED → aiStatus = unresolved（未纳入，绝不显示「已纳入计划」）
 *   - 无计划 / 无可拆分意图 → 保持既有状态（accepted 表示约束已采纳，非计划覆盖）
 */
export function projectCommentCoverage(comment: Comment, plan: TripPlan | undefined): Comment {
  // 无计划时不做覆盖投影：既有状态反映「约束已采纳」，计划尚未生成，
  // 不应被误判为「未解析」，也不应虚假显示「已纳入计划」。
  if (!plan) return comment;
  const intents = splitCommentIntoAtomicIntents(comment.rawText);
  const coverage = computeIntentCoverage(intents, plan);
  if (!coverage) return comment;

  const status: Comment['aiStatus'] =
    coverage.incorporation === 'INCORPORATED'
      ? 'accepted'
      : coverage.incorporation === 'PARTIALLY_INCORPORATED'
        ? 'partially_incorporated'
        : 'unresolved';

  return { ...comment, aiStatus: status, intentCoverage: coverage };
}
