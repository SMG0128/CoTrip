// tests/run-tests.ts
// 测试入口：依次运行所有核心逻辑测试。
// 运行方式：npm test

import './constraint-parser.test';
import './conflict-detector.test';
import './plan-reconciler.test';
import './candidate-ranker.test';
import './event-candidates.test';
import './tencent-map-adapter.test';
import './external-action-resolver.test';
import './current-user.test';
import './trip-ownership.test';
import { runRealTripServiceTests } from './real-trip-service.test';

async function main(): Promise<void> {
  await runRealTripServiceTests();
  console.log('\n🎉 全部核心逻辑测试通过');
}

main().catch((error) => {
  console.error(error);
  throw error;
});
