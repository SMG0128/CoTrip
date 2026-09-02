// services/comment-judge.ts
// JudgeAgent 确定性核心（纯函数，无副作用）。
//
// JudgeAgent 只回答：「这条输入是否包含足够的、与当前行程相关的可执行信息，值得交给 PlanAgent？」
// 它不回答「具体应该怎么改计划」—— 新增/删除/修改活动、调整顺序、决定插入位置、
// 修改 duration/time、选择 POI、调腾讯地图、重算 route 全部属于 PlanAgent。
//
// 放行原则（本次架构调整的核心）：
//   只要存在可执行的 trip-related signal（地点/时长/时间/顺序词/动作词/预算/餐饮/查询），
//   且合理地可能需要修改、查询或理解当前行程，就应该放行。
//   「复杂」≠「不可解析」；「一个句子多个动作」≠「不可解析」；
//   「省略主语」≠「不可解析」；「依赖当前 itinerary 上下文」≠「不可解析」。
//   「找不到精确 POI」也不得拒绝 —— POI alias resolution 是下一层责任。

import {
  JudgeResult,
  JudgeStatus,
  JudgeIntentDomain,
  TripSignals,
} from '../types/comment-judge';
import { splitCommentIntoAtomicIntents } from './comment-intent-coverage';
import { parseDurationMinutes } from './duration-parser';
import { extractFoodKeyword } from './trip-plan-post-processor';

/** 计划修改类动词（删/换/改/调整/安排/提前/推后…） */
const PLAN_MOD_VERBS = /删|去掉|取消|移除|换成|换|改为|改成|调整|安排|提前|推后|延长|缩短|加长|增加|减少|改期/;
/** 移动类动词（去/前往…） */
const MOVEMENT_VERBS = /去|前往|再到|去往|出发|动身/;
/** 停留/活动类动词（看/读/参观/逛/玩/打/吃…） */
const STAY_VERBS = /看|读|参观|游览|逛|玩|打|吃|喝|休息|散步|骑行|游泳|跑步|加班|办公|开会|拍摄/;
/** 查询类表达（READ：我下午有什么安排 / 计划里有省博吗 / 几点去北京路） */
const QUERY_PATTERN = /几点|什么时候|什么安排|什么计划|有没有|有.{0,8}吗|安排是|计划是|行程是|在哪里|怎么去|能不能去|可以吗|需要去/;
/** 预算/价格类关键词 */
const BUDGET_PATTERN = /预算|价格|价钱|费用|花费|不超过|控制在|便宜|贵|省钱|资金|人均|团费/;
/** 明确改计划的独立信号（PlanAgent 的 UPDATE/DELETE/MOVE 意图） */
const EXPLICIT_PLAN_CHANGE_PATTERN = /删|去掉|取消|移除|换成|换成|改为|改成|调整|安排|提前|推后|延长|缩短|加长|增加|减少|改期|换到|改成|推迟/;

const TIME_EXPRESSION_PATTERN =
  /早上|上午|中午|下午|晚上|傍晚|清晨|凌晨|半夜|\d{1,2}\s*[点时][半刻钟]*|几点|今天|明天|后天|大后天|昨天|前天|周末|周[一二三四五六日天]|星期[一二三四五六日天]/g;

const DURATION_PATTERN =
  /一个半小时|两个半小时|三个半小时|[一二两三四五六七八九十\d]+\s*(?:个\s*)?小时\s*(?:[一二两三四五六七八九十\d]+\s*分钟)?|[一二两三四五六七八九十\d]+\s*分钟/g;

const SEQUENCE_WORD_PATTERN = /再(?!见)|然后|接着|之后|再去|再走|再往后|之前|以前|以后|随后|随即|紧接着|先|最后|中途|顺路|前面|后面|回|再回/g;

const ACTION_WORD_PATTERN =
  /删|去掉|取消|移除|换成|换|改为|改成|调整|安排|提前|推后|延长|缩短|加长|增加|减少|去|前往|走|看|读|参观|游览|逛|玩|打|吃|喝|休息|散步|骑行|游泳|跑步|回|出发/g;

/** 轻量地点后缀匹配（「把越秀公园删了」→「越秀公园」） */
const PLACE_SUFFIX_PATTERN =
  /[\u4e00-\u9fa5]{2,10}(?:公园|博物馆|图书馆|美术馆|书店|科技馆|纪念馆|展览馆|体育场|体育馆|广场|地铁站|火车站|高铁站|机场|码头|塔|寺|庙|宫|祠|园|山|湖|河|江|湾|岛|路|街|大道|中心|商场|商城|餐厅|饭店|酒楼|菜馆|酒店|民宿|景区|度假区|城)/g;

const NOISE_PATTERN = /^(?:\s*[哈呵嘻吼嘿喔噢额哦呃诶嗯啊呀哇欸][\s!！~～。.，,、？?]*)+$/;
const GREETING_PATTERN =
  /^(?:你好|您好|哈喽|哈罗|嗨|hi|hello|hey|谢谢|多谢|感谢|好的|好|可以|没问题|收到|辛苦|在吗|在不在|拜拜|再见|晚安|早安|早上好|下午好|晚上好)[\s!！。.~～]*$/i;
const WEATHER_PATTERN = /天气|气温|下雨|下雨天|打雷|打台风|台风|降温|升温|空气|湿度|雾霾/;
/** 纯夸奖/反馈类表达（地点 + 夸奖 ≠ 可执行行程请求） */
const FEEDBACK_PATTERN = /真(?:好|棒|不错|好看|漂亮|美|舒服|好玩|赞)|不错|好看|漂亮|很喜欢|喜欢|有意思|太棒|蛮好|挺好/;

/** 地点候选清洗：剔除「把越秀公园删了」这类候选中的动作词与引导词 */
const PLACE_CLEAN_VERB_PATTERN =
  /删|去掉|取消|移除|换成|改为|改成|调整|安排|提前|推后|延长|缩短|加长|增加|减少|改期|待|逛|看|参观|游览|玩|休息|回|走|去|出发|前往/g;
const PLACE_LEADING_STRIP_PATTERN = /^[把请将]/;
const PLACE_DEICTIC_PATTERN = /^(?:这|那|一个|这个|那个|什么|哪个|附近)/;

/** 把来自原子拆分/后缀匹配的候选清洗为可信地点短语；不可信返回 undefined */
function sanitizePlaceCandidate(raw: string, wholeText: string): string | undefined {
  let candidate = raw.trim();
  if (!candidate || candidate === wholeText) return undefined;
  candidate = candidate.replace(PLACE_LEADING_STRIP_PATTERN, '');
  candidate = candidate.split(PLACE_CLEAN_VERB_PATTERN)[0].trim();
  if (!candidate || candidate === wholeText) return undefined;
  if (candidate.length < 2 || candidate.length > 12) return undefined;
  if (PLACE_DEICTIC_PATTERN.test(candidate)) return undefined;
  return candidate;
}

function emptySignals(): TripSignals {
  return { places: [], timeExpressions: [], durationExpressions: [], sequenceWords: [], actionWords: [] };
}

function pushUnique(target: string[], value: string): void {
  if (value && !target.includes(value)) target.push(value);
}

/** 从原始输入抽取最小行程信号 */
export function detectTripSignals(rawText: string): TripSignals {
  const text = (rawText ?? '').trim();
  const signals = emptySignals();
  if (!text) return signals;

  // 地点：复用原子意图拆分（含别名归一化，如「省博」→「广东省博物馆」），
  // 候选统一清洗（「把越秀公园删了」→「越秀公园」；纯噪音/整句回显 → 丢弃）
  for (const intent of splitCommentIntoAtomicIntents(text)) {
    if (intent.location) {
      const candidate = sanitizePlaceCandidate(intent.location, text);
      if (candidate) pushUnique(signals.places, candidate);
    }
  }
  // 地点：轻量后缀匹配（把越秀公园删了 → 越秀公园；去省博看… → 省博无后缀，由上面覆盖）
  for (const match of text.matchAll(PLACE_SUFFIX_PATTERN)) {
    const candidate = sanitizePlaceCandidate(match[0], text);
    if (candidate) pushUnique(signals.places, candidate);
  }

  for (const match of text.matchAll(TIME_EXPRESSION_PATTERN)) {
    pushUnique(signals.timeExpressions, match[0]);
  }

  for (const match of text.matchAll(DURATION_PATTERN)) {
    pushUnique(signals.durationExpressions, match[0]);
  }
  if (signals.durationExpressions.length === 0) {
    // 兜底：解析器可解析但正则未命中（如「俩小时」「两钟头」）
    const parsed = parseDurationMinutes(text);
    if (parsed.ok) pushUnique(signals.durationExpressions, `${parsed.durationMinutes} 分钟`);
  }

  for (const match of text.matchAll(SEQUENCE_WORD_PATTERN)) {
    pushUnique(signals.sequenceWords, match[0]);
  }

  for (const match of text.matchAll(ACTION_WORD_PATTERN)) {
    pushUnique(signals.actionWords, match[0]);
  }

  return signals;
}

function isEmptySignals(signals: TripSignals): boolean {
  return (
    signals.places.length === 0 &&
    signals.timeExpressions.length === 0 &&
    signals.durationExpressions.length === 0 &&
    signals.sequenceWords.length === 0 &&
    signals.actionWords.length === 0
  );
}

/**
 * 是否存在可执行的行程相关信号。
 * 时间表达单独出现（如「周末的行程看起来不错」）不算可执行信号；
 * 但时间 + 动作/地点 组合（如「明天去爬山」）算。
 */
export function hasExecutableTripSignal(signals: TripSignals, rawText: string): boolean {
  const text = (rawText ?? '').trim();
  // 地点 + 纯夸奖（「越秀公园风景真好」）不是可执行的行程请求；
  // 但「省博」单独出现（隐式新增）仍是请求。
  const hasPlace = signals.places.length > 0 && !FEEDBACK_PATTERN.test(text);
  const hasDuration = signals.durationExpressions.length > 0;
  const hasTime = signals.timeExpressions.length > 0;
  const hasSequence = signals.sequenceWords.length > 0;
  const hasPlanMod = signals.actionWords.some((word) => PLAN_MOD_VERBS.test(word));
  const hasMovement = signals.actionWords.some((word) => MOVEMENT_VERBS.test(word));
  const hasStay = signals.actionWords.some((word) => STAY_VERBS.test(word));
  const hasBudget = BUDGET_PATTERN.test(text);
  const hasMeal = extractFoodKeyword(text) !== undefined;
  const hasQuery = QUERY_PATTERN.test(text);

  return (
    hasPlace ||
    hasDuration ||
    hasBudget ||
    hasMeal ||
    hasPlanMod ||
    hasQuery ||
    (hasTime && (hasMovement || hasStay || hasPlanMod || hasPlace)) ||
    (hasSequence && (hasMovement || hasStay || hasDuration || hasPlace))
  );
}

/**
 * 是否存在「明确要改计划」的独立信号（PlanAgent 的 UPDATE/DELETE/MOVE 意图）。
 * 用于 updateRequired 的确定性兜底：复杂但明确要改行程的表达，
 * 即使 LLM 保守判为「不需要修改」，也仍进入 PlanAgent 评估。
 */
export function hasExplicitPlanChangeSignal(signals: TripSignals, rawText: string): boolean {
  const text = (rawText ?? '').trim();
  if (EXPLICIT_PLAN_CHANGE_PATTERN.test(text)) return true;
  // 复合顺序表达：地点或时长 + 顺序词（「看两个小时书再去省博看一个小时再走」）
  if (signals.sequenceWords.length > 0 && (signals.places.length > 0 || signals.durationExpressions.length > 0)) {
    return true;
  }
  return false;
}

/**
 * JudgeAgent 确定性放行判定。
 * @returns JudgeResult（shouldForward / status / intentDomain / signals / reason）
 */
export function judgeShouldForward(rawText: string): JudgeResult {
  const text = (rawText ?? '').trim();
  if (!text) {
    return {
      shouldForward: false,
      status: 'insufficient',
      intentDomain: 'unknown',
      signals: emptySignals(),
      reason: '空输入',
    };
  }

  const signals = detectTripSignals(text);

  // 噪音 / 寒暄优先于信号判定：原子拆分器可能把纯噪音误识别出地点，但必须不得放行。
  if (NOISE_PATTERN.test(text)) {
    return {
      shouldForward: false,
      status: 'irrelevant',
      intentDomain: 'non_trip',
      signals,
      reason: '纯噪音/表情，无任何行程信息',
    };
  }

  if (GREETING_PATTERN.test(text)) {
    return {
      shouldForward: false,
      status: 'insufficient',
      intentDomain: 'unknown',
      signals,
      reason: '寒暄/确认，无可执行的行程信息',
    };
  }

  if (hasExecutableTripSignal(signals, text)) {
    return {
      shouldForward: true,
      status: 'actionable',
      intentDomain: 'trip',
      signals,
      reason: '检测到可执行的行程相关信号',
    };
  }

  if (WEATHER_PATTERN.test(text)) {
    return {
      shouldForward: false,
      status: 'unsupported',
      intentDomain: 'non_trip',
      signals,
      reason: '天气类话题不在行程修改范围内',
    };
  }

  if (isEmptySignals(signals)) {
    return {
      shouldForward: false,
      status: 'insufficient',
      intentDomain: 'unknown',
      signals,
      reason: '未检测到任何行程相关信号',
    };
  }

  return {
    shouldForward: false,
    status: 'insufficient',
    intentDomain: 'unknown',
    signals,
    reason: '存在弱信号但不足以构成可执行的行程请求',
  };
}

/**
 * 由 LLM envelope decision（relevant/usable/updateRequired）推导最终 JudgeResult。
 *
 * 放行原则：LLM 判定 + 确定性信号兜底（兜底只放行、不收紧）。
 * 这样「复杂但有效的行程表达」即使被 LLM 保守判为 relevant=false/usable=false，
 * 只要确定性信号充分，仍应交给 PlanAgent。
 */
export function deriveJudgeResult(
  decision: { relevant: boolean; usable: boolean; updateRequired: boolean },
  rawText: string,
): JudgeResult {
  const text = (rawText ?? '').trim();
  const signals = detectTripSignals(text);
  const hint = judgeShouldForward(text);

  const llmForward = decision.relevant && decision.usable;
  const shouldForward = llmForward || hint.shouldForward;

  const status: JudgeStatus = shouldForward ? 'actionable' : hint.status;
  const intentDomain: JudgeIntentDomain = shouldForward ? 'trip' : hint.intentDomain;
  const reason = shouldForward
    ? llmForward
      ? hint.shouldForward
        ? 'LLM 判定可执行（确定性信号确认）'
        : 'LLM 判定可执行'
      : '确定性信号兜底放行（复杂但有效的行程表达）'
    : hint.reason;

  return { shouldForward, status, intentDomain, signals, reason };
}
