import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { validateAICommentAnalysis } from '../src/services/ai-comment-validation';
import { AICommentServiceError } from '../src/services/ai-comment-service';
import { record } from './run-tests';

interface ValidFixture {
  name: string;
  analysis: unknown;
}

interface InvalidFixture extends ValidFixture {
  failurePath: string;
  failureReasonCode: string;
}

interface ContractFixtures {
  valid: ValidFixture[];
  invalid: InvalidFixture[];
}

function loadFixtures(): ContractFixtures {
  const fixturePath = path.resolve(
    process.cwd(),
    '../contracts/ai-comment-analysis-fixtures.json',
  );
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as ContractFixtures;
}

const fixtures = loadFixtures();

export async function runAICommentContractTests(): Promise<void> {
  for (const fixture of fixtures.valid) {
    await record(`AI contract valid: ${fixture.name}`, () => {
      assert.doesNotThrow(() => validateAICommentAnalysis(fixture.analysis));
    });
  }

  for (const fixture of fixtures.invalid) {
    await record(`AI contract invalid: ${fixture.name}`, () => {
      assert.throws(
        () => validateAICommentAnalysis(fixture.analysis),
        (error: unknown) => error instanceof AICommentServiceError
          && error.code === 'AI_INVALID_RESPONSE',
      );
    });
  }

  await record('AI contract canonical: mixed 与 chat 均通过 Server revalidation', () => {
    const mixed = fixtures.valid.find((fixture) => fixture.name === 'mixed availability and dining preference');
    const chat = fixtures.valid.find((fixture) => fixture.name === 'chat without constraints');
    assert.ok(mixed);
    assert.ok(chat);
    const mixedResult = validateAICommentAnalysis(mixed.analysis);
    const chatResult = validateAICommentAnalysis(chat.analysis);
    assert.strictEqual(mixedResult.constraints[0].value.availableUntil, '2026-08-29T17:00:00+08:00');
    assert.strictEqual(mixedResult.constraints[1].value.keyword, '越南菜');
    assert.deepStrictEqual(chatResult.constraints, []);
  });
}
