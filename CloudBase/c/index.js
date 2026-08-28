// CloudBase/c/index.js
// CoTrip CloudBase HTTP Function：评论分析 AI 网关。
// 链路：Mini Program → CoTrip Server → 本网关 → hunyuan-v3 (hy3)
// 本函数只做：认证、输入校验、AI 调用、AI JSON 基础 shape 校验。
// 权威 schema/domain validation 仍在 CoTrip Server 执行（网关不是信任边界）。

const http = require('http');
const tcb = require('@cloudbase/node-sdk');
const { createGateway } = require('./lib/gateway');
const { createCloudBaseAIProvider } = require('./lib/cloudbase-ai');
const { readBody } = require('./lib/request-parser');

const PORT = Number(process.env.PORT || 9000);

/** 组装 HTTP server；aiProvider / secret 可注入（测试模式用 mock AI + 测试 secret）。 */
function createServer({ aiProvider, secret }) {
  const gateway = createGateway({ aiProvider, secret });

  return http.createServer(async (req, res) => {
    try {
      const bodyText = await readBody(req);
      const { status, headers, body } = await gateway.handle({
        method: req.method,
        url: req.url,
        headers: req.headers,
        bodyText,
      });
      res.writeHead(status, headers);
      res.end(JSON.stringify(body));
    } catch (error) {
      if (error && error.code === 'REQUEST_TOO_LARGE') {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'REQUEST_TOO_LARGE' }));
        return;
      }
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'INTERNAL_ERROR' }));
    }
  });
}

if (require.main === module) {
  // Secret 来自云函数环境变量 COTRIP_AI_GATEWAY_SECRET，绝不硬编码、绝不打日志。
  const secret = process.env.COTRIP_AI_GATEWAY_SECRET || '';
  const app = tcb.init({
    env: process.env.TCB_ENV_ID,
    timeout: 60000,
  });
  const aiProvider = createCloudBaseAIProvider(app.ai());
  const server = createServer({ aiProvider, secret });
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`cotrip-ai-analyze listening on ${PORT}`);
  });
}

module.exports = { createServer };
