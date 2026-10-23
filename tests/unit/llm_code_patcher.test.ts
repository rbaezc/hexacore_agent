import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { LlmCodePatcher } from '../../src/features/quality_assurance/services/llm_code_patcher.js';
import { QAAutonomousLoop } from '../../src/features/quality_assurance/services/qa_autonomous_loop.js';
import { ChangeJournal } from '../../src/shared/infrastructure/change_journal.js';
import { WorkspaceContext } from '../../src/shared/infrastructure/workspace.js';
import { QAResult } from '../../src/features/quality_assurance/domain/qa_types.js';
import { InMemoryFileSystem } from '../helpers/in_memory_fs.js';
import { createTestHexaCore } from '../helpers/test_hexacore.js';

const ROOT = path.resolve('/ws');
const failure: QAResult = {
  stack: 'node',
  check: 'test',
  status: 'failed',
  passed: false,
  command: 'npx vitest run',
  reportFormat: 'json',
  totalTests: 1,
  passedTests: 0,
  failedTestsCount: 1,
  skippedTests: 0,
  failures: [{ file: 'src/sum.test.ts', testName: 'sums', errorMessage: 'expected 3 to be 4' }],
  rawStdout: '',
  rawStderr: '',
};

function patcherReturning(response: object) {
  const fs = new InMemoryFileSystem({
    [path.join(ROOT, 'src/sum.ts')]: 'export const sum = (a: number, b: number) => a - b;\n',
    [path.join(ROOT, 'src/sum.test.ts')]: "expect(sum(2, 2)).toBe(4);\n",
  });
  const workspace = new WorkspaceContext(ROOT);
  let prompt = '';
  const llm = {
    async complete(req: { prompt: string }) {
      prompt = req.prompt;
      return `Here you go:\n${JSON.stringify(response)}`;
    },
  };
  return { fs, patcher: new LlmCodePatcher(fs, workspace, new ChangeJournal(fs, workspace), llm), prompt: () => prompt };
}

describe('LlmCodePatcher', () => {
  it('applies a valid search/replace to implementation code, through a checkpoint', async () => {
    const { fs, patcher, prompt } = patcherReturning({ explanation: 'subtract → add', edits: [{ file: 'src/sum.ts', search: 'a - b', replace: 'a + b' }] });
    const outcome = await patcher.applyFix(failure);
    expect(outcome.applied).toBe(true);
    expect(outcome.checkpointId).toMatch(/^cp_/);
    expect(await fs.readFile(path.join(ROOT, 'src/sum.ts'))).toContain('a + b');
    expect(prompt()).toContain('READ-ONLY test file');
  });

  it('refuses to edit test files — tests are the specification', async () => {
    const { fs, patcher } = patcherReturning({ explanation: 'cheat', edits: [{ file: 'src/sum.test.ts', search: 'toBe(4)', replace: 'toBe(0)' }] });
    const outcome = await patcher.applyFix(failure);
    expect(outcome.applied).toBe(false);
    expect(outcome.summary).toContain('test file');
    expect(await fs.readFile(path.join(ROOT, 'src/sum.test.ts'))).toContain('toBe(4)');
  });

  it('rejects ambiguous or missing search blocks and paths outside the workspace', async () => {
    for (const edit of [
      { file: 'src/sum.ts', search: 'b', replace: 'c' },
      { file: 'src/sum.ts', search: 'not present', replace: 'x' },
      { file: '../outside.ts', search: '', replace: 'x' },
      { file: 'node_modules/lib/index.js', search: '', replace: 'x' },
    ]) {
      const { patcher } = patcherReturning({ explanation: 'x', edits: [edit] });
      expect((await patcher.applyFix(failure)).applied).toBe(false);
    }
  });
});

describe('QAAutonomousLoop', () => {
  it('rolls back a patch that makes things worse and stops', async () => {
    const { services, fs } = createTestHexaCore([1, 3]);
    await services.scaffolding.executeScaffolding({ stack: 'node', sliceName: 'orders' });
    const handlerPath = path.join(services.workspace.root, 'src/features/orders/application/orders_handler.ts');
    const before = await fs.readFile(handlerPath);

    const patcher = new LlmCodePatcher(fs, services.workspace, services.journal, {
      async complete() {
        return JSON.stringify({ explanation: 'bad idea', edits: [{ file: 'src/features/orders/application/orders_handler.ts', search: 'if (!input.id) {', replace: 'if (input.id) {' }] });
      },
    });
    const loop = new QAAutonomousLoop(services.qaRunner, 3, services.journal);
    const res = await loop.runAutonomousLoop({ stack: 'node', cwd: services.workspace.root }, patcher);

    expect(res.isSuccess).toBe(true);
    if (!res.isSuccess) return;
    expect(res.value.attempts.map((a) => a.status)).toEqual(['failed', 'patched', 'rolled_back']);
    expect(res.value.finalResult.failedTestsCount).toBe(1);
    expect(await fs.readFile(handlerPath)).toBe(before);
  });
});
