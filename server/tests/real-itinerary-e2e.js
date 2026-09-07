// 真实 AI Gateway + 腾讯地图；本地 HTTP API 和隔离 JSON 仓库。无模型/地图 stub。
// 先 npm run build，然后 npm run e2e:real。缺配置或网络失败必须退出非零。
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { JsonTripRepository } = require('../dist/repositories/json-trip-repository');
const { JsonCommentRepository } = require('../dist/repositories/json-comment-repository');
const { JsonUserRepository } = require('../dist/repositories/json-user-repository');
const { RealTripService } = require('../dist/services/trip-service');
const { CommentService } = require('../dist/services/comment-service');
const { UnavailableAICommentService } = require('../dist/services/ai-comment-service');
const { CloudBaseGatewayTripPreprocessAIService } = require('../dist/services/cloudbase-gateway-trip-preprocess-ai-service');
const { CloudBaseGatewayCommentEvaluationAIService } = require('../dist/services/cloudbase-gateway-comment-evaluation-ai-service');
const { CloudBaseGatewayInitialGenerationAIService } = require('../dist/services/cloudbase-gateway-initial-generation-ai-service');
const { CloudBaseGatewayTripUpdateAIService } = require('../dist/services/cloudbase-gateway-trip-update-ai-service');
const { TripPlanGenerationService, DefaultTripPlanPostProcessor } = require('../dist/services/trip-plan-generation-service');
const { TencentLBSService } = require('../dist/services/tencent-lbs-service');
const { TencentDirectionService } = require('../dist/services/tencent-direction-service');
const { HmacTokenService } = require('../dist/services/token-service');
const { tripRouter } = require('../dist/routes/trips');
const { commentRouter } = require('../dist/routes/comments');
const { errorHandler } = require('../dist/middleware/error-handler');
const { postProcessTripPlan } = require('../dist/services/trip-plan-post-processor');
const { sanitizePlanForPersist } = require('../dist/services/plan-persist-sanitizer');

const report = { REAL_INITIAL_GENERATION_E2E: 'FAIL', REAL_TRIP_UPDATE_E2E: 'FAIL', cases: {} };
async function main() {
  const missing = ['TENCENT_MAP_KEY', 'AI_GATEWAY_URL', 'AI_GATEWAY_SECRET'].filter(key => !process.env[key]);
  if (missing.length) {
    report.blocker = `未配置 ${missing.join(', ')}`;
    process.exitCode = 2;
    return;
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cotrip-real-e2e-'));
  let server;
  try {
    const options = { gatewayUrl: process.env.AI_GATEWAY_URL, secret: process.env.AI_GATEWAY_SECRET, timeoutMs: 90000 };
    const file = path.join(directory, 'trips.json');
    const trips = new JsonTripRepository(file);
    const users = new JsonUserRepository(path.join(directory, 'users.json'));
    await users.create({ id: 'e2e-user', wechatOpenId: 'isolated-e2e-identity', nickname: 'E2E', avatarUrl: '', profileCompleted: true, createdAt: 1, updatedAt: 1 });
    const lbs = new TencentLBSService({ key: process.env.TENCENT_MAP_KEY });
    const directions = new TencentDirectionService({ key: process.env.TENCENT_MAP_KEY });
    const pipeline = new TripPlanGenerationService(trips, new CloudBaseGatewayCommentEvaluationAIService(options), new CloudBaseGatewayInitialGenerationAIService(options), new CloudBaseGatewayTripUpdateAIService(options), new DefaultTripPlanPostProcessor(lbs, directions));
    const comments = new CommentService(new JsonCommentRepository(path.join(directory, 'comments.json')), trips, users, new UnavailableAICommentService(), undefined, pipeline);
    const tokens = new HmacTokenService(require('crypto').randomBytes(32).toString('hex'));
    const app = express(); app.use(express.json());
    app.use('/trips', tripRouter(new RealTripService(trips, Math.random, new CloudBaseGatewayTripPreprocessAIService(options)), tokens));
    app.use('/trips', commentRouter(comments, tokens)); app.use(errorHandler);
    server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    const url = `http://127.0.0.1:${server.address().port}/trips`;
    const headers = { Authorization: `Bearer ${tokens.sign('e2e-user')}`, 'Content-Type': 'application/json' };
    const date = new Date(Date.now() + 32 * 3600000).toISOString().slice(0, 10);
    const timeRange = { start: `${date}T09:00:00+08:00`, end: `${date}T23:59:00+08:00`, timezone: 'Asia/Shanghai' };
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ title: '广州一日游', initialBrief: '广东省博物馆、粤菜、广州塔', areaConstraint: { city: '广州市' }, timeRange }) });
    assert.equal(response.status, 201);
    const { trip } = await response.json();
    async function submit(rawText) {
      const response = await fetch(`${url}/${trip.id}/comments`, { method: 'POST', headers, body: JSON.stringify({ rawText }) });
      assert.equal(response.status, 201);
      const read = await fetch(`${url}/${trip.id}`, { headers });
      const dto = await read.json();
      const stored = await new JsonTripRepository(file).findById(trip.id);
      assert.deepEqual(dto.trip.currentPlan, stored.currentPlan, 'API/重启 DB 不一致');
      assert(dto.trip.currentPlan, '未生成计划');
      return dto.trip.currentPlan;
    }
    const placeName = event => event.location?.name || event.restaurant?.name || '';
    const initial = await submit('明天在广州玩一天，上午去广东省博物馆，中午吃粤菜，下午去广州塔。');
    assert.equal(initial.status, 'actionable', '首版仍不可执行');
    const museum = initial.events.find(e => placeName(e).includes('博物馆'));
    const meal = initial.events.find(e => e.type === 'DINING');
    const tower = initial.events.find(e => placeName(e).includes('广州塔'));
    assert(museum && meal?.restaurant && tower, '三项意图或真实餐厅缺失');
    assert(initial.events.indexOf(museum) < initial.events.indexOf(meal) && initial.events.indexOf(meal) < initial.events.indexOf(tower));
    report.REAL_INITIAL_GENERATION_E2E = 'PASS'; report.cases.initial = 'PASS';
    const changed = await submit('下午不要去广州塔了，改成陈家祠。');
    assert.equal(changed.version, initial.version + 1);
    assert.equal(changed.status, 'actionable');
    const chen = changed.events.find(e => e.id === tower.id);
    assert(chen && /陈家祠|陈氏书院/.test(placeName(chen)), '目标活动未正确修改');
    assert.deepEqual(changed.events.filter(e => e.id !== tower.id).map(e => e.id), initial.events.filter(e => e.id !== tower.id).map(e => e.id));
    assert(!changed.events.some(e => e.route?.origin?.id === tower.location.id || e.route?.destination?.id === tower.location.id), '旧路线残留');
    report.REAL_TRIP_UPDATE_E2E = 'PASS'; report.cases.changePlace = 'PASS';
    const timed = await submit('把博物馆推迟到下午两点。');
    assert.equal(timed.version, changed.version + 1);
    assert(timed.events.find(e => e.id === museum.id)?.time.start.includes('T14:00'), '时间未修改到原活动');
    assert.equal(timed.status, 'actionable'); report.cases.changeTime = 'PASS';
    const transit = await submit('去陈家祠这段我想坐地铁。');
    const destination = transit.events.find(e => e.id === tower.id);
    assert.equal(destination.transportPreference, 'transit');
    assert(destination.route ? destination.route.mode === 'transit' && destination.route.provider === 'tencent' : destination.routeStatus === 'unavailable');
    report.cases.transport = 'PASS';
    const nearby = await submit('中午找一家附近的粤菜。');
    assert(nearby.events.find(e => e.id === meal.id)?.restaurant?.location); report.cases.nearby = 'PASS';
    const unresolved = await submit('把陈家祠改成不存在的地点：绝不存在的紫色月球粤穗馆ZXQ987654。');
    assert.equal(unresolved.status, 'needs_attention');
    const missingPlace = unresolved.events.find(e => e.id === tower.id);
    assert(missingPlace && missingPlace.locationStatus !== 'resolved' && !missingPlace.route && !missingPlace.location);
    report.cases.unresolved = 'PASS';
    const shortPlan = { ...initial, events: [
      { ...museum, location: undefined, route: undefined, locationRequirement: { query: '广东省博物馆' } },
      { id: 'short-library', type: 'OTHER', title: '广州图书馆', time: { start: `${date}T17:00:00+08:00`, end: `${date}T18:00:00+08:00`, timezone: 'Asia/Shanghai' }, locationRequirement: { query: '广州图书馆' } },
    ] };
    const short = sanitizePlanForPersist((await postProcessTripPlan({ plan: shortPlan, timeRange, city: '广州市' }, lbs, directions)).plan, date);
    assert.equal(short.status, 'actionable');
    // 路线选择契约：未指定交通偏好时按 walking → transit → driving 请求，selected 必须是
    // 真实候选中最短 duration 者（平局 walking 优先）。真实 Tencent 在地点极近时可能返回
    // driving/transit 更快，因此绝不强制「必须 walking」；short 只验证真实路线已落库。
    assert.equal(short.events[1].route.provider, 'tencent', '短途必须来源真实腾讯路线');
    assert(short.events[1].route.mode !== undefined, '短途必须落地一个真实 mode 的路线');
    report.shortRouteSelectedMode = short.events[1].route.mode;
    report.cases.shortDistance = 'PASS';
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
main().catch(error => { report.failure = error.code || 'E2E_ASSERTION_FAILED'; process.exitCode = 1; })
  .finally(() => console.log(JSON.stringify({ VERDICT: process.exitCode ? 'FAIL' : 'PASS', ...report }, null, 2)));
