import { TripPlan, TripPlanEvent } from '../types/trip-plan';
import { AITripUpdateEnvelope, TripEditScope } from '../types/ai-trip-update';
import { AITripItem } from '../types/ai-initial-generation';

const UPDATE = /推迟到|推后到|提前到|改到|改成|改为|换成|调整到|推迟|推后|提前|延长|缩短/;
const REPLAN = /重新安排|重新规划|重新生成|重排|重做整个|全部重新|协调|调整后[面续]|安排后[面续]/;

/** 只从用户原文与当前版本的稳定 ID 解析授权，不信任模型自报的修改范围。 */
export function resolveTripEditScope(text: string, plan: TripPlan): TripEditScope | undefined {
  const clauses = text.split(/[，,。；;！!]/);
  if (clauses.some(clause => REPLAN.test(clause) && !/不要|不用|无需|无须|不需要|不必|禁止|别/.test(clause))) return undefined;
  const verb = UPDATE.exec(text);
  if (!verb) return undefined;
  const subject = text.slice(0, verb.index).replace(/^(?:请|帮我|麻烦|把|将|我想|我希望|的|时间|开始时间|活动|参观|游览|去|在|\s)+/g, '').replace(/(?:的)?(?:开始时间|时间|活动)$/, '').trim();
  if (subject.length < 2) return undefined;
  const matches = plan.events.filter(event => [event.title, event.locationRequirement?.query, event.location?.name]
    .some(name => name && (name.includes(subject) || subject.includes(name))));
  if (matches.length !== 1) return undefined;
  const target = matches[0];
  const tail = text.slice(verb.index + verb[0].length);
  // 多目标或复合新增/删除请求保留现有全计划能力，不能误截成单活动修改。
  if (plan.events.some(event => event.id !== target.id && [event.title, event.locationRequirement?.query, event.location?.name].some(name => name && tail.includes(name)))
    || /(?:并|然后|再|顺便).*(?:新增|添加|去|删除|取消)/.test(tail)) return undefined;
  const absoluteStartTime = parseAbsoluteClock(tail);
  return { mode: 'single_activity', targetActivityId: target.id, ...(absoluteStartTime ? { absoluteStartTime } : {}) };
}

function chineseNumber(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (value.includes('十')) {
    const [tens, units] = value.split('十');
    return (tens ? digits[tens] : 1) * 10 + (units ? digits[units] : 0);
  }
  return digits[value];
}

/** 绝对墙钟时刻；不把「推迟两小时」这样的相对时长当作时刻。 */
function parseAbsoluteClock(text: string): string | undefined {
  const match = /^(?:\s*)(上午|早上|凌晨|中午|下午|晚上)?\s*([零一二两三四五六七八九十\d]+)(?:点|时|[:：])(?:([零一二两三四五六七八九十\d]+)分?|半)?/.exec(text);
  if (!match) return undefined;
  let hour = chineseNumber(match[2]);
  const minute = match[3] ? chineseNumber(match[3]) : match[0].endsWith('半') ? 30 : 0;
  if (/下午|晚上|中午/.test(match[1] ?? '') && hour < 12) hour += 12;
  if (match[1] === '凌晨' && hour === 12) hour = 0;
  if (!Number.isInteger(hour) || hour > 23 || !Number.isInteger(minute) || minute > 59) return undefined;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function itemFromEvent(event: TripPlanEvent): AITripItem {
  return { id: event.id, type: event.type, title: event.title, time: event.time,
    ...(event.locationRequirement ? { locationRequirement: event.locationRequirement } : {}),
    ...(event.alternatives ? { alternatives: event.alternatives } : {}),
    ...(event.transportPreference ? { transportPreference: event.transportPreference } : {}) };
}

/** 仅对通过 schema 的完整快照使用：丢弃越界操作，按原顺序重建；目标缺失则拒绝。 */
export function normalizeScopedTripUpdate(envelope: AITripUpdateEnvelope, previous: TripPlan, scope?: TripEditScope): AITripUpdateEnvelope | undefined {
  if (!scope) return envelope;
  const target = envelope.trip.items.find(item => item.id === scope.targetActivityId);
  if (!target || envelope.ui?.removedEventIds?.includes(scope.targetActivityId)) return undefined;
  const items = previous.events.map(event => {
    if (event.id !== scope.targetActivityId) return itemFromEvent(event);
    if (!scope.absoluteStartTime) return target;
    const start = `${event.time.start.slice(0, 10)}T${scope.absoluteStartTime}:00${event.time.start.slice(19)}`;
    const duration = Date.parse(event.time.end ?? '') - Date.parse(event.time.start);
    const end = Number.isFinite(duration) && duration > 0
      ? new Date(Date.parse(start) + duration + 8 * 3600000).toISOString().replace(/\.\d{3}Z$/, '+08:00') : undefined;
    return { ...target, time: { start, ...(end ? { end } : {}), timezone: event.time.timezone } };
  });
  return { ...envelope, trip: { ...envelope.trip, items },
    ui: { changedEventIds: [scope.targetActivityId], highlightEventIds: [scope.targetActivityId], removedEventIds: [], message: null } };
}

/** 后处理允许刷新路线事实，但不得修改非目标活动属性或重排，目标时间也不得被顺延。 */
export function enforceAppliedEditScope(plan: TripPlan, scopedInput: TripPlan, scope?: TripEditScope): TripPlan {
  if (!scope) return plan;
  const byId = new Map(plan.events.map(event => [event.id, event]));
  return { ...plan, events: scopedInput.events.map(original => {
    const processed = byId.get(original.id);
    if (original.id === scope.targetActivityId) return { ...(processed ?? original), time: original.time };
    const { route: _route, routeStatus: _status, ...preserved } = original;
    return { ...preserved, ...(processed?.route ? { route: processed.route } : {}), ...(processed?.routeStatus ? { routeStatus: processed.routeStatus } : {}) };
  }) };
}
