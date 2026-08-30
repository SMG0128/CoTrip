// tests/run-tests.js
// CloudBase 网关测试运行器（Node 原生，无外部依赖）。
// 注意：record 必须先导出再 require 测试文件，避免 CJS 循环依赖拿到空导出。

const results = [];

async function record(name, fn) {
  const entry = { name, pass: false, error: '' };
  results.push(entry);
  try {
    await fn();
    entry.pass = true;
  } catch (error) {
    entry.error = (error && error.message) || String(error);
  }
}

module.exports.record = record;

const { runGatewayTests } = require('./gateway.test');
const { runCoordinateTests } = require('./coordinate.test');

async function main() {
  await runGatewayTests();
  await runCoordinateTests();

  let failed = 0;
  for (const r of results) {
    if (r.pass) {
      console.log(`  ok  ${r.name}`);
    } else {
      failed += 1;
      console.log(`  FAIL ${r.name} — ${r.error}`);
    }
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
