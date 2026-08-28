// tests/smoke.js
// 本地 HTTP smoke：启动真实 HTTP server + 注入 mock AI + 测试 secret。
// 绝不真实访问 hy3，不消耗任何 Token。

const http = require('http');
const assert = require('assert');
const { createServer } = require('../index');

const SECRET = 'cotrip-smoke-secret';
const MOCK_ANALYSIS = {
  intent: 'constraint',
  constraints: [
    { type: 'AVAILABILITY', scope: 'TRIP', priority: 'HARD', value: { availableAfter: '2026-09-01T10:00:00+08:00' } },
  ],
  confidence: 0.9,
  requiresConfirmation: false,
};

function mockAIProvider() {
  return {
    async analyze() {
      return { text: JSON.stringify(MOCK_ANALYSIS) };
    },
  };
}

function request(port, { method, path, headers, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function main() {
  const server = createServer({ aiProvider: mockAIProvider(), secret: SECRET });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  let failed = 0;
  async function check(name, fn) {
    try {
      await fn();
      console.log(`  ok  ${name}`);
    } catch (error) {
      failed += 1;
      console.log(`  FAIL ${name} — ${(error && error.message) || error}`);
    }
  }

  await check('GET /health → 200', async () => {
    const res = await request(port, { method: 'GET', path: '/health' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.service, 'cotrip-ai-analyze');
  });

  await check('POST /analyze 无认证 → 401', async () => {
    const res = await request(port, { method: 'POST', path: '/analyze', headers: { 'Content-Type': 'application/json' }, body: { rawText: '想打羽毛球' } });
    assert.strictEqual(res.status, 401);
  });

  await check('POST /analyze 错误 secret → 401', async () => {
    const res = await request(port, { method: 'POST', path: '/analyze', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer nope' }, body: { rawText: '想打羽毛球' } });
    assert.strictEqual(res.status, 401);
  });

  await check('POST /analyze 正确认证 + 测试模式 → 200', async () => {
    const res = await request(port, {
      method: 'POST',
      path: '/analyze',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
      body: { rawText: '我下午五点前必须走', context: { tripId: 'trip_smoke' } },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.analysis.intent, 'constraint');
  });

  await check('POST /analyze 非法 JSON → 400', async () => {
    const res = await request(port, {
      method: 'POST',
      path: '/analyze',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
      body: '{bad json',
    });
    assert.strictEqual(res.status, 400);
  });

  await new Promise((resolve) => server.close(resolve));
  console.log(failed === 0 ? '\nSMOKE PASS' : '\nSMOKE FAIL');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
