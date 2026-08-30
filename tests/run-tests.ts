// tests/run-tests.ts
// 测试入口：依次运行所有核心逻辑测试。
// 运行方式：npm test

import './constraint-parser.test';
import './conflict-detector.test';
import './plan-reconciler.test';
import './constraint-evaluator.test';
import './real-comment-planning.test';
import './trip-detail-on-show.test';
import './comment-composer.test';
import './comment-author.test';
import './candidate-ranker.test';
import './event-candidates.test';
import './tencent-map-adapter.test';
import './external-action-resolver.test';
import './current-user.test';
import './room-code.test';
import './trip-ownership.test';
import './trip-share.test';
import './trip-card.test';
import { runHomeMultiTripsTests } from './home-multi-trips.test';
import { runRealTripServiceTests } from './real-trip-service.test';
import { runCommentSyncTests } from './comment-sync.test';
import { runRealCommentServiceTests } from './real-comment-service.test';
import { runTripCompleteTests } from './trip-complete.test';
import { runTripDeleteTests } from './trip-delete.test';
import { runRouteOptionTests } from './route-option.test';
import { runRouteOptionsUiTests } from './route-options-ui.test';
import { runGuangzhouMetroTests } from './guangzhou-metro.test';
import { runJoinFlowTests } from './join-flow.test';
import { runDemoTripTests } from './demo-trip.test';
import { runAuthFlowTests } from './auth-flow.test';
import { runAvatarTests } from './avatar.test';

async function main(): Promise<void> {
  await runHomeMultiTripsTests();
  await runRealTripServiceTests();
  await runCommentSyncTests();
  await runRealCommentServiceTests();
  await runTripCompleteTests();
  await runTripDeleteTests();
  await runRouteOptionTests();
  await runRouteOptionsUiTests();
  await runGuangzhouMetroTests();
  await runJoinFlowTests();
  await runDemoTripTests();
  await runAuthFlowTests();
  await runAvatarTests();
  console.log('\n🎉 全部核心逻辑测试通过');
}

main().catch((error) => {
  console.error(error);
  throw error;
});
