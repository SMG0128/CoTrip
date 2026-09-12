import assert from 'assert';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Server } from 'http';
import { JsonTripRepository } from '../src/repositories/json-trip-repository';
import { JsonCommentRepository } from '../src/repositories/json-comment-repository';
import { JsonUserRepository } from '../src/repositories/json-user-repository';
import { CommentService } from '../src/services/comment-service';
import { UnavailableAICommentService } from '../src/services/ai-comment-service';
import { RealTripService } from '../src/services/trip-service';
import { HmacTokenService } from '../src/services/token-service';
import { DefaultTripPlanPostProcessor, TripPlanGenerationService } from '../src/services/trip-plan-generation-service';
import { CloudBaseGatewayCommentEvaluationAIService } from '../src/services/cloudbase-gateway-comment-evaluation-ai-service';
import { CloudBaseGatewayInitialGenerationAIService } from '../src/services/cloudbase-gateway-initial-generation-ai-service';
import { CloudBaseGatewayTripUpdateAIService } from '../src/services/cloudbase-gateway-trip-update-ai-service';
import { TencentLBSService } from '../src/services/tencent-lbs-service';
import { TencentDirectionService } from '../src/services/tencent-direction-service';
import { commentRouter } from '../src/routes/comments';
import { tripRouter } from '../src/routes/trips';
import { errorHandler } from '../src/middleware/error-handler';
import { AITripItem } from '../src/types/ai-initial-generation';
import { TripUpdateAIInput } from '../src/types/ai-trip-update';
import { TripPlan } from '../src/types/trip-plan';
import { Trip } from '../src/types/trip';
import { emptyAIUIConfig } from '../src/types/ai-envelope';
import { validateItinerary } from '../src/services/itinerary-validator';
import { buildUpdatedTripPlan, validateTripUpdateEnvelope } from '../src/services/trip-update-ai-validation';
import { postProcessTripPlan } from '../src/services/trip-plan-post-processor';
import { sanitizePlanForPersist } from '../src/services/plan-persist-sanitizer';
import { validateAITripSnapshot } from '../src/services/ai-trip-snapshot-validation';
import { diffTripPlans } from '../src/services/trip-plan-diff';
import { enforceAppliedEditScope } from '../src/services/trip-edit-scope';
import { record } from './run-tests';

const time = (hour: number, day = '2026-09-07') => ({ start: `${day}T${hour}:00:00+08:00`, end: `${day}T${hour + 1}:00:00+08:00`, timezone: 'Asia/Shanghai' });
const initialItems: AITripItem[] = [
  { type: 'OTHER', title: '参观博物馆', time: time(10), locationRequirement: { query: '广东省博物馆' } },
  { type: 'DINING', title: '午餐', time: time(12), locationRequirement: { query: '附近粤菜' } },
  { type: 'OTHER', title: '登塔', time: time(15), locationRequirement: { query: '广州塔' } },
];
// 地图响应夹具只用于确定性集成测试，绝不注入 runtime，也不声称是真实联网结果。
const pois = [
  { id: 'museum', title: '广东省博物馆', address: '珠江东路2号', location: { lat: 23.117, lng: 113.321 } },
  { id: 'restaurant', title: '测试粤菜馆（珠江新城店）', address: '测试地址', location: { lat: 23.118, lng: 113.322 } },
  { id: 'tower', title: '广州塔', address: '阅江西路222号', location: { lat: 23.106, lng: 113.324 } },
  { id: 'chen', title: '陈家祠', address: '中山七路', location: { lat: 23.129, lng: 113.246 } },
  { id: 'library', title: '广州图书馆', address: '珠江东路4号', location: { lat: 23.119, lng: 113.321 } },
];

async function listen(app: ReturnType<typeof express>): Promise<{ server: Server; url: string }> {
  const server = await new Promise<Server>(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  const address = server.address();
  assert(address && typeof address !== 'string');
  return { server, url: `http://127.0.0.1:${address.port}` };
}
async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

export async function runItineraryPipelineTests(): Promise<void> {
  await record('itinerary HTTP E2E: 生成→换地点→改时间→指定地铁→模糊地点→无法解析→短途比较→重启', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cotrip-itinerary-'));
    const calls: { from: string; to: string; mode: string }[] = [];
    const inputs: { requestType: string; currentPlan?: TripPlan; editScope?: TripUpdateAIInput['editScope'] }[] = [];
    let transitUnavailable = false;
    const gatewayModule = require(path.resolve(__dirname, '../../../CloudBase/c/lib/gateway.js')) as {
      createGateway(options: { secret: string; aiProvider: { tripPipeline(type: string, input: TripUpdateAIInput): Promise<{ text: string }> } }): {
        handle(input: { method: string; url: string; headers: Record<string, string>; bodyText: string }): Promise<{ status: number; body: unknown }>;
      };
    };
    const gateway = gatewayModule.createGateway({ secret: 'integration-secret', aiProvider: {
      async tripPipeline(requestType, input) {
        inputs.push({ requestType, currentPlan: input.currentPlan, editScope: input.editScope });
        const base = { schemaVersion: '1.0', requestType, status: 'success', analysis: {}, decision: { tripChanged: true }, ui: emptyAIUIConfig(), meta: {} };
        if (requestType === 'COMMENT_EVALUATION') return { text: JSON.stringify({ ...base, analysis: { commentIntent: '修改行程' }, decision: { relevant: true, usable: true, updateRequired: true, reason: '明确的行程意图' }, trip: null }) };
        let items = initialItems;
        if (requestType === 'TRIP_UPDATE') {
          items = input.currentPlan.events.map(e => ({ id: e.id, title: e.title, type: e.type, time: e.time, locationRequirement: e.locationRequirement, transportPreference: e.transportPreference }));
          const text = input.triggeringComment.rawText;
          if (text.includes('陈家祠') && !text.includes('地铁')) items[2] = { ...items[2], title: '参观陈家祠', locationRequirement: { query: '陈家祠' } };
          if (text.includes('两点')) items[0] = { ...items[0], time: time(14) };
          if (text.includes('地铁')) items[2] = { ...items[2], transportPreference: 'transit' };
          if (text.includes('找一家')) items[1] = { ...items[1], title: '中午吃粤菜', locationRequirement: { query: '附近粤菜' } };
          if (text.includes('不存在')) items[2] = { ...items[2], title: '不存在的测试地点', locationRequirement: { query: '不存在的测试地点' } };
          if (text.includes('图书馆')) items[2] = { ...items[2], title: '广州图书馆', locationRequirement: { query: '广州图书馆' }, transportPreference: 'walking' };
        }
        return { text: JSON.stringify({ ...base, trip: { title: input.title, summary: '行程安排', items } }) };
      },
    } });
    const gatewayApp = express();
    gatewayApp.use(express.text({ type: '*/*' }));
    gatewayApp.post('*', async (req, res) => {
      const result = await gateway.handle({ method: req.method, url: req.path, headers: { authorization: req.headers.authorization ?? '' }, bodyText: req.body as string });
      res.status(result.status).json(result.body);
    });
    const gw = await listen(gatewayApp);
    const options = { gatewayUrl: gw.url, secret: 'integration-secret' };
    const tripsFile = path.join(directory, 'trips.json');
    const trips = new JsonTripRepository(tripsFile);
    const users = new JsonUserRepository(path.join(directory, 'users.json'));
    await users.create({ id: 'test-user', wechatOpenId: 'test-openid', nickname: '测试用户', avatarUrl: '', profileCompleted: true, createdAt: 1, updatedAt: 1 });
    const lbs = new TencentLBSService({ key: 'test-only', fetchImpl: async url => {
      const query = new URL(url).searchParams;
      const keyword = query.get('keyword');
      const candidates = keyword?.includes('粤菜') ? [pois[1]] : pois.filter(poi => poi.title === keyword);
      return { ok: true, json: async () => ({ status: 0, data: candidates }) };
    } });
    const directions = new TencentDirectionService({ key: 'test-only', fetchImpl: async url => {
      const parsed = new URL(url); const query = parsed.searchParams; const mode = parsed.pathname.split('/').filter(Boolean).pop()!;
      calls.push({ from: query.get('from')!, to: query.get('to')!, mode });
      return { ok: true, json: async () => ({ status: 0, result: { routes: transitUnavailable && mode === 'transit' ? [] : [{ duration: mode === 'walking' ? 6 : mode === 'transit' ? 20 : 12, distance: 398 }] } }) };
    } });
    const pipeline = new TripPlanGenerationService(trips, new CloudBaseGatewayCommentEvaluationAIService(options), new CloudBaseGatewayInitialGenerationAIService(options), new CloudBaseGatewayTripUpdateAIService(options), new DefaultTripPlanPostProcessor(lbs, directions));
    const comments = new CommentService(new JsonCommentRepository(path.join(directory, 'comments.json')), trips, users, new UnavailableAICommentService(), undefined, pipeline);
    const tokens = new HmacTokenService('test-api-secret');
    const app = express(); app.use(express.json());
    app.use('/trips', tripRouter(new RealTripService(trips), tokens));
    app.use('/trips', commentRouter(comments, tokens)); app.use(errorHandler);
    const api = await listen(app);
    const headers = { Authorization: `Bearer ${tokens.sign('test-user')}`, 'Content-Type': 'application/json' };
    try {
      const create = await fetch(`${api.url}/trips`, { method: 'POST', headers, body: JSON.stringify({ title: '广州一日游', initialBrief: '', areaConstraint: { city: '广州市' }, timeRange: { start: time(9).start, end: time(20).end, timezone: 'Asia/Shanghai' } }) });
      assert.equal(create.status, 201);
      const { trip } = await create.json() as { trip: Trip };
      const submit = async (rawText: string): Promise<TripPlan> => {
        const response = await fetch(`${api.url}/trips/${trip.id}/comments`, { method: 'POST', headers, body: JSON.stringify({ rawText }) });
        assert.equal(response.status, 201);
        const read = await fetch(`${api.url}/trips/${trip.id}`, { headers });
        const dto = await read.json() as { trip: Trip };
        const restarted = await new JsonTripRepository(tripsFile).findById(trip.id);
        assert.deepStrictEqual(dto.trip.currentPlan, restarted!.currentPlan, 'API 与重启后 DB 完全一致');
        return dto.trip.currentPlan!;
      };
      const initial = await submit('明天在广州玩一天，上午去广东省博物馆，中午吃粤菜，下午去广州塔。');
      assert.equal(initial.status, 'actionable');
      assert.deepEqual(initial.events.map(e => e.location?.id), ['museum', 'restaurant', 'tower']);
      assert.equal(initial.events[1].route!.origin!.id, 'museum');
      assert.equal(initial.events[1].route!.destination!.id, 'restaurant');
      assert(initial.events.slice(1).every(e => e.route?.provider === 'tencent' && e.route.mode === 'walking'));
      const changed = await submit('下午不要去广州塔了，改成陈家祠。');
      assert.equal(changed.version, initial.version + 1);
      assert.deepEqual(changed.events.map(e => e.id), initial.events.map(e => e.id));
      assert.deepEqual(changed.events[0].location, initial.events[0].location);
      assert.deepEqual(changed.events[1].restaurant, initial.events[1].restaurant);
      assert.equal(changed.events[2].route!.destination!.id, 'chen');
      assert(!JSON.stringify(changed.events[2]).includes('tower'));
      assert(inputs.filter(i => i.requestType === 'TRIP_UPDATE').every(i => i.currentPlan?.events[0].location?.id === 'museum'), '完整已解析计划通过真实 Gateway 校验到达 PlanAgent');
      const timed = await submit('把博物馆推迟到下午两点。');
      assert.equal(timed.events[0].id, initial.events[0].id);
      assert.equal(timed.events[0].time.start, time(14).start);
      assert.deepStrictEqual(inputs[inputs.length - 1].editScope, { mode: 'single_activity', targetActivityId: initial.events[0].id, absoluteStartTime: '14:00' }, '范围穿过真实 Gateway 契约到达 PlanAgent');
      assert.equal(timed.status, 'needs_attention');
      assert(timed.validationIssues?.some(issue => issue.code === 'TIME_CONFLICT'));
      assert.deepStrictEqual(timed.events.slice(1).map(e => e.time), changed.events.slice(1).map(e => e.time));
      const beforeTransit = calls.length;
      const transit = await submit('去陈家祠这段我想坐地铁。');
      assert.equal(transit.events[2].route!.mode, 'transit');
      assert.equal(transit.events[1].route!.mode, 'walking');
      const targetCalls = calls.slice(beforeTransit).filter(call => call.to === `${pois[3].location.lat},${pois[3].location.lng}`);
      assert.deepEqual(targetCalls.map(call => call.mode), ['transit']);
      const meal = await submit('中午找一家附近的粤菜。');
      assert.equal(meal.events[1].locationStatus, 'resolved');
      assert.equal(meal.events[1].location!.id, 'restaurant');
      transitUnavailable = true;
      const unresolved = await submit('把陈家祠改成不存在的测试地点。');
      assert.equal(unresolved.status, 'needs_attention');
      assert.equal(unresolved.events[2].locationStatus, 'unresolved');
      assert.equal(unresolved.events[2].location, undefined);
      assert.equal(unresolved.events[2].route, undefined);
      const repaired = await submit('改回陈家祠。');
      assert.equal(repaired.events[2].route, undefined, 'transit 不可用不能伪造或换成 walking');
      assert.equal(repaired.events[2].routeStatus, 'unavailable');
      const short = await submit('改成广州图书馆并步行。');
      assert.equal(short.events[2].route!.mode, 'walking');
      assert.equal(short.events[2].route!.distanceMeters, 398);
      const noOp = await submit('保持现在的行程安排');
      assert.equal(noOp.version, short.version, '内容不变不增版本');
      const broken = JSON.parse(JSON.stringify(short)) as TripPlan;
      broken.events[2].route!.origin = initial.events[0].location;
      assert.equal(validateItinerary(broken).status, 'needs_attention');
      assert.equal(validateItinerary(broken).events[2].route, undefined);
      const lostIdentity = { schemaVersion: '1.0', requestType: 'TRIP_UPDATE', status: 'success', analysis: {}, decision: { tripChanged: true }, trip: { title: '广州一日游', summary: '重新生成', items: initialItems }, ui: emptyAIUIConfig() };
      assert.equal(validateTripUpdateEnvelope(lostIdentity, short).ok, false, '整份换 ID 的覆盖必须拒绝');
      await trips.addParticipant(trip.id, 'joined-while-planning');
      assert(await trips.commitPlan(trip.id, short.version, { ...short, version: short.version + 1 }, { planVersion: short.version + 1, requestType: 'TRIP_UPDATE', ui: emptyAIUIConfig(), updatedAt: short.updatedAt }));
      assert.equal(await trips.commitPlan(trip.id, short.version, short, { planVersion: short.version, requestType: 'TRIP_UPDATE', ui: emptyAIUIConfig(), updatedAt: short.updatedAt }), false);
      assert((await trips.findById(trip.id))!.participantIds.includes('joined-while-planning'));
    } finally {
      await close(api.server); await close(gw.server);
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  const baseline = (): TripPlan => ({ id: 'plan', tripId: 'trip', version: 1, updatedAt: '2026-09-06T00:00:00Z',
    satisfiedConstraintCount: 0, totalConstraintCount: 0, conflicts: [],
    events: initialItems.map((item, index) => ({ ...item, id: `stable-${index}`, location: {
      id: pois[index].id, name: pois[index].title, latitude: pois[index].location.lat, longitude: pois[index].location.lng,
      providerRefs: [{ provider: 'tencent', externalId: pois[index].id }],
    } })),
  });
  const resolve = async (
    plan: TripPlan,
    previousPlan?: TripPlan,
    durationForDestination: (destination: string) => number = () => 6,
    editScope?: TripUpdateAIInput['editScope'],
    scopedInput?: TripPlan,
  ) => {
    const calls: string[] = [];
    const result = await postProcessTripPlan({ plan, previousPlan, editScope, city: '广州市', timeRange: { start: time(9).start, end: time(20, '2026-09-08').end } },
      new TencentLBSService({ key: 'test', fetchImpl: async url => ({ ok: true, json: async () => ({ status: 0, data: pois.filter(poi => poi.title === new URL(url).searchParams.get('keyword')) }) }) }),
      new TencentDirectionService({ key: 'test', fetchImpl: async url => {
        const query = new URL(url).searchParams;
        const destination = query.get('to')!;
        calls.push(`${query.get('from')}→${destination}`);
        return { ok: true, json: async () => ({ status: 0, result: { routes: [{ duration: durationForDestination(destination), distance: 398 }] } }) };
      } }));
    const enforced = editScope && scopedInput ? enforceAppliedEditScope(result.plan, scopedInput, editScope) : result.plan;
    return { plan: sanitizePlanForPersist(enforced, '2026-09-07', '2026-09-08'), calls };
  };
  const proposal = (plan: TripPlan, items: AITripItem[], removedEventIds: string[] = []) => ({ schemaVersion: '1.0', requestType: 'TRIP_UPDATE' as const, status: 'success' as const,
    analysis: {}, decision: { tripChanged: true as const }, trip: { title: '广州一日游', summary: '调整行程', items }, ui: { ...emptyAIUIConfig(), removedEventIds } });
  const intentItems = (plan: TripPlan): AITripItem[] => plan.events.map(event => ({ id: event.id, type: event.type, title: event.title, time: event.time, locationRequirement: event.locationRequirement }));

  await record('itinerary: single_activity 换地点且路线可行时保持 actionable、稳定 ID 与零无关操作', async () => {
    const base = (await resolve(baseline())).plan;
    const items = intentItems(base);
    items[1] = { ...items[1], type: 'OTHER', title: '参观陈家祠', locationRequirement: { query: '陈家祠' } };
    const envelope = proposal(base, items);
    assert(validateTripUpdateEnvelope(envelope, base).ok);
    const updated = buildUpdatedTripPlan(envelope, base, base.updatedAt);
    assert(updated.events.every(e => !e.route), '后处理前旧路线全部失效');
    const { plan, calls } = await resolve(updated, base);
    assert.equal(calls.length, 6);
    assert.equal(plan.events[1].route!.destination!.id, 'chen');
    assert.equal(plan.events[2].route!.origin!.id, 'chen');
    assert.equal(plan.events[1].id, base.events[1].id);
    assert.deepEqual(plan.events[0].location, base.events[0].location);
    assert(!JSON.stringify(plan.events.map(e => e.route)).includes('restaurant'));
    assert.equal(plan.status, 'actionable');
    assert.deepStrictEqual(diffTripPlans(base, plan).filter(operation => operation.eventId !== base.events[1].id), []);
  });
  await record('itinerary: single_activity 换地点后路线超出原时间窗时保留修改并精确返回 TIME_CONFLICT', async () => {
    const source = baseline();
    source.events[2].time = {
      start: '2026-09-07T13:30:00+08:00',
      end: '2026-09-07T14:30:00+08:00',
      timezone: 'Asia/Shanghai',
    };
    const towerCoordinates = `${pois[2].location.lat},${pois[2].location.lng}`;
    const chenCoordinates = `${pois[3].location.lat},${pois[3].location.lng}`;
    const duration = (destination: string): number => destination === chenCoordinates ? 50 : destination === towerCoordinates ? 20 : 6;
    const base = (await resolve(source, undefined, duration)).plan;
    assert.equal(base.status, 'actionable', '旧地点 20 分钟路线应能在原时间前到达');
    const items = intentItems(base);
    items[2] = { ...items[2], title: '参观陈家祠', locationRequirement: { query: '陈家祠' } };
    const scope = { mode: 'single_activity' as const, targetActivityId: base.events[2].id };
    const envelope = proposal(base, items);
    assert(validateTripUpdateEnvelope(envelope, base, false, scope).ok);
    const updated = buildUpdatedTripPlan(envelope, base, base.updatedAt);
    const { plan } = await resolve(updated, base, duration, scope, updated);
    const target = plan.events.find(event => event.id === base.events[2].id);
    assert(target);
    assert.equal(target.location?.id, 'chen');
    assert.equal(target.route?.destination?.id, 'chen');
    assert.equal(target.route?.durationMinutes, 50);
    assert.equal(target.time.start, base.events[2].time.start, '局部换地点不得隐式移动目标时间');
    assert.equal(plan.status, 'needs_attention');
    assert.deepStrictEqual(plan.validationIssues, [{ eventId: base.events[2].id, code: 'TIME_CONFLICT' }]);
    assert.deepStrictEqual(diffTripPlans(base, plan).filter(operation => operation.eventId !== base.events[2].id), []);
  });
  await record('itinerary: 删除中间节点后直连 A→C，插入与重排仍按 ID 对齐路线', async () => {
    const base = (await resolve(baseline())).plan;
    const items = intentItems(base).filter((_, index) => index !== 1);
    const envelope = proposal(base, items, [base.events[1].id]);
    assert(validateTripUpdateEnvelope(envelope, base).ok);
    const { plan } = await resolve(buildUpdatedTripPlan(envelope, base, base.updatedAt), base);
    assert.equal(plan.events[1].route!.fromEventId, base.events[0].id);
    assert.equal(plan.events[1].route!.destination!.id, 'tower');
    const inserted = [...intentItems(plan)];
    inserted.splice(1, 0, { type: 'OTHER', title: '广州图书馆', locationRequirement: { query: '广州图书馆' }, time: time(13) });
    const next = (await resolve(buildUpdatedTripPlan(proposal(plan, inserted), plan, plan.updatedAt), plan)).plan;
    assert.equal(new Set(next.events.map(e => e.id)).size, 3);
    assert.equal(next.events[2].route!.fromEventId, next.events[1].id);
    const reordered = [intentItems(next)[2], intentItems(next)[0], intentItems(next)[1]];
    const moved = (await resolve(buildUpdatedTripPlan(proposal(next, reordered), next, next.updatedAt), next)).plan;
    assert.deepEqual(moved.events.map(e => e.id), reordered.map(e => e.id));
    assert.equal(moved.events[1].route!.origin!.id, 'tower');
  });
  await record('itinerary: 第二天保留独立日期，不计算跨日交通；严格 start < end', async () => {
    const plan = baseline();
    plan.events[2].time = time(10, '2026-09-08');
    const result = await resolve(plan);
    assert.equal(result.plan.events[2].time.start.slice(0, 10), '2026-09-08');
    assert.equal(result.plan.events[2].routeStatus, 'not_required');
    assert.equal(result.calls.length, 3);
    result.plan.events[0].time.end = result.plan.events[0].time.start;
    assert(validateItinerary(result.plan).validationIssues!.some(issue => issue.code === 'TIME_INVALID'));
  });
  await record('itinerary: 缺地点、NaN/越界坐标禁止路线，失败餐厅不得借前一地点', async () => {
    const plan = baseline();
    delete plan.events[1].location;
    plan.events[2].location!.latitude = 120;
    plan.events[2].locationRequirement = { query: '不存在的地方' };
    const result = await resolve(plan);
    assert.equal(result.calls.length, 0);
    assert.equal(result.plan.events[1].location, undefined);
    assert.equal(result.plan.events[1].locationStatus, 'unresolved');
    assert.equal(result.plan.status, 'needs_attention');
    const invalid = baseline(); invalid.events[0].location!.longitude = NaN;
    assert.equal(sanitizePlanForPersist(invalid, undefined).events[0].location, undefined);
  });
  await record('AI snapshot: transportPreference / locationRequirement 的 null = 未指定（不得丢弃整份合法 snapshot）', () => {
    // 真实回归：hy3 把未指定的可选字段输出为 null（transportPreference、district…），
    // 过严的「非 undefined 即必须合法」校验会连带丢弃整份合法计划（计划不生成）。
    const snapshot = {
      title: '广州一日游',
      summary: '博物馆、粤菜、广州塔',
      items: [
        { type: 'OTHER', title: '参观博物馆', time: time(10), locationRequirement: { query: '广东省博物馆', city: '广州市', district: null }, transportPreference: null },
        { type: 'DINING', title: '午餐', time: time(12), locationRequirement: { query: '附近粤菜' }, transportPreference: 'walking' },
      ],
    };
    const result = validateAITripSnapshot(snapshot, { allowItemIds: false });
    assert.equal(result.ok, true, JSON.stringify(result));
  });
  await record('AI snapshot: transportPreference 非法值仍然拒绝（校验强度不变）', () => {
    const snapshot = {
      title: '广州一日游',
      summary: '博物馆、粤菜、广州塔',
      items: [
        { type: 'OTHER', title: '参观博物馆', time: time(10), locationRequirement: { query: '广东省博物馆' }, transportPreference: '地铁' },
      ],
    };
    const result = validateAITripSnapshot(snapshot, { allowItemIds: false });
    assert.equal(result.ok, false);
    assert.equal(result.failurePath, 'trip.items[0].transportPreference');
    assert.equal(result.failureReasonCode, 'TRANSPORT_PREFERENCE_INVALID');
    // 非 null 的非法类型仍然拒绝（校验强度不变）
    const badDistrict = validateAITripSnapshot({
      title: '广州一日游',
      summary: '博物馆、粤菜、广州塔',
      items: [{ type: 'OTHER', title: '参观博物馆', time: time(10), locationRequirement: { district: 123 } }],
    }, { allowItemIds: false });
    assert.equal(badDistrict.ok, false);
    assert.equal(badDistrict.failureReasonCode, 'LOCATION_REQUIREMENT_NOT_STRING');
    // 必填字段写成 null 仍然按「缺失」拒绝（剔除 null 不等于放宽必填校验）
    const missingTitle = validateAITripSnapshot({
      title: '广州一日游',
      summary: '博物馆、粤菜、广州塔',
      items: [{ type: 'OTHER', title: null, time: time(10) }],
    }, { allowItemIds: false });
    assert.equal(missingTitle.ok, false);
    assert.equal(missingTitle.failureReasonCode, 'ITEM_TITLE_REQUIRED');
  });
}
