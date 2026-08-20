// server/tests/run-tests.ts
// 极简测试运行器：逐个执行测试文件，汇总结果。

import { runAuthTests } from './auth.test';
import { runTripTests } from './trips.test';

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
  await runTripTests();

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
