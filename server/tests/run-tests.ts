// server/tests/run-tests.ts
// 极简测试运行器：逐个执行测试文件，汇总结果。

import { runAuthTests } from './auth.test';
import { runRoomCodeTests } from './room-code.test';
import { runTripTests } from './trips.test';
import { runTripCompleteTests } from './trip-complete.test';
import { runTripDeleteTests } from './trip-delete.test';
import { runTripJoinTests } from './trip-join.test';
import { runTripCommentTests } from './trip-comments.test';
import { runAICommentServiceTests } from './ai-comment-service.test';
import { runAICommentContractTests } from './ai-comment-contract.test';
import { runCloudBaseGatewayTests } from './cloudbase-gateway-ai-comment-service.test';
import { runTripCoordinationTests } from './trip-coordination.test';
import { runTripPreprocessTests } from './trip-preprocess.test';
import { runTripPlanGenerationTests } from './trip-plan-generation.test';
import { runAIEnvelopeTests } from './ai-envelope.test';
import { runTripUpdateTests } from './trip-update.test';
import { runProductionReadinessTests } from './production-readiness.test';

interface TestResult {
  name: string;
  pass: boolean;
  error?: string;
}

const results: TestResult[] = [];

export async function record(name: string, fn: () => void | Promise<void>): Promise<void> {
  const entry: TestResult = { name, pass: false };
  results.push(entry);
  try {
    await fn();
    entry.pass = true;
  } catch (e) {
    entry.error = (e as Error).message;
  }
}

async function main(): Promise<void> {
  await runAuthTests();
  await runRoomCodeTests();
  await runTripTests();
  await runTripCompleteTests();
  await runTripDeleteTests();
  await runTripJoinTests();
  await runTripCommentTests();
  await runAICommentServiceTests();
  await runAICommentContractTests();
  await runCloudBaseGatewayTests();
  await runTripCoordinationTests();
  await runTripPreprocessTests();
  await runTripPlanGenerationTests();
  await runAIEnvelopeTests();
  await runTripUpdateTests();
  await runProductionReadinessTests();

  let failed = 0;
  for (const r of results) {
    if (r.pass) {
      console.log(`  ✓ ${r.name}`);
    } else {
      failed += 1;
      console.log(`  ✗ ${r.name}${r.error ? ` — ${r.error}` : ''}`);
    }
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
