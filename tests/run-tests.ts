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

console.log('\n🎉 全部核心逻辑测试通过');
