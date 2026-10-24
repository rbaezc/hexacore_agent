import * as path from 'node:path';
import { createHexaCore, HexaCoreServices } from '../../src/composition_root.js';
import { IProcessRunner, ProcessExecutionResult } from '../../src/shared/infrastructure/process_runner.js';
import { InMemoryFileSystem } from './in_memory_fs.js';

export const TEST_ROOT = path.resolve('/workspace');

/** A vitest JSON report with the given number of failures (written where the runner was told to). */
export function vitestReport(failures: number): string {
  return JSON.stringify({
    numTotalTests: 2,
    numPassedTests: 2 - Math.min(failures, 2),
    numFailedTests: failures,
    testResults: [
      {
        name: path.join(TEST_ROOT, 'src/features/orders/tests/orders_handler.test.ts'),
        status: failures ? 'failed' : 'passed',
        assertionResults: Array.from({ length: failures }, (_, i) => ({
          status: 'failed',
          fullName: `case ${i}`,
          failureMessages: ['expected id'],
        })),
      },
    ],
  });
}

/**
 * Full HexaCore wired to an in-memory node/vitest workspace. `testFailures` yields the failure
 * count for each successive test run (the last value repeats).
 */
export function createTestHexaCore(testFailures: number[] = [0]): { services: HexaCoreServices; fs: InMemoryFileSystem; runs: () => number } {
  const fs = new InMemoryFileSystem({
    [path.join(TEST_ROOT, 'package.json')]: JSON.stringify({ devDependencies: { vitest: '^4' } }),
  });
  let runs = 0;
  const runner: IProcessRunner = {
    async runCommand(_cmd, args = []): Promise<ProcessExecutionResult> {
      const out = args.find((a) => a.startsWith('--outputFile='));
      if (!out) return { stdout: '', stderr: '', exitCode: 0, success: true };
      const failures = testFailures[Math.min(runs++, testFailures.length - 1)];
      await fs.writeFile(out.slice('--outputFile='.length), vitestReport(failures));
      return failures ? { stdout: '', stderr: '', exitCode: 1, success: false, failureKind: 'exit_code' } : { stdout: '', stderr: '', exitCode: 0, success: true };
    },
  };
  const services = createHexaCore({ workspaceRoot: TEST_ROOT, fileSystem: fs, processRunner: runner, telemetryLog: false });
  return { services, fs, runs: () => runs };
}
