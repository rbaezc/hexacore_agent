import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { QARunnerService } from '../../src/features/quality_assurance/services/qa_runner_service.js';
import { IProcessRunner, ProcessExecutionResult, RunCommandOptions } from '../../src/shared/infrastructure/process_runner.js';
import { InMemoryFileSystem } from '../helpers/in_memory_fs.js';

const PROJECT = path.resolve('/project');

interface Call {
  command: string;
  args: string[];
  options: RunCommandOptions;
}

/** Fake runner that can also "write" a report file the way a real test runner would. */
function fakeRunner(fs: InMemoryFileSystem, respond: (call: Call) => ProcessExecutionResult & { report?: string }): IProcessRunner & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    async runCommand(command, args = [], options = {}) {
      const call = { command, args, options };
      calls.push(call);
      const { report, ...result } = respond(call);
      if (report !== undefined) {
        const flag = args.find((a) => a.startsWith('--outputFile=') || a.startsWith('--junitxml=') || a.startsWith('--log-junit='));
        const file = flag ? flag.slice(flag.indexOf('=') + 1) : args[args.indexOf('--out') + 1];
        await fs.writeFile(file, report);
      }
      return result;
    },
  };
}

const vitestProject = () => new InMemoryFileSystem({ [path.join(PROJECT, 'package.json')]: JSON.stringify({ devDependencies: { vitest: '^4' } }) });

describe('QARunnerService', () => {
  it('reads the vitest JSON report instead of guessing from stdout', async () => {
    const fs = vitestProject();
    const report = JSON.stringify({
      numTotalTests: 3,
      numPassedTests: 2,
      numFailedTests: 1,
      numPendingTests: 0,
      testResults: [
        {
          name: '/project/src/features/orders/tests/orders.test.ts',
          status: 'failed',
          assertionResults: [
            { status: 'passed', fullName: 'orders creates' },
            { status: 'failed', fullName: 'orders rejects', failureMessages: ['AssertionError: expected 1 to be 2\n at x'], location: { line: 12 } },
          ],
        },
      ],
    });
    const runner = fakeRunner(fs, () => ({ stdout: 'noise', stderr: '', exitCode: 1, success: false, failureKind: 'exit_code', report }));
    const qa = new QARunnerService(runner, fs);

    const res = await qa.runQA({ stack: 'node', cwd: PROJECT });
    expect(res.isSuccess).toBe(true);
    if (!res.isSuccess) return;
    expect(res.value.reportFormat).toBe('json');
    expect(res.value.totalTests).toBe(3);
    expect(res.value.failedTestsCount).toBe(1);
    expect(res.value.failures[0]).toMatchObject({ testName: 'orders rejects', line: 12, errorMessage: 'AssertionError: expected 1 to be 2' });
    expect(runner.calls[0].args).toContain('--reporter=json');
  });

  it('never reports a non-zero exit as passed, even when nothing could be parsed', async () => {
    const fs = vitestProject();
    const runner = fakeRunner(fs, () => ({ stdout: '', stderr: 'SyntaxError: Unexpected token', exitCode: 1, success: false, failureKind: 'exit_code' }));
    const res = await new QARunnerService(runner, fs).runQA({ stack: 'node', cwd: PROJECT });
    expect(res.isSuccess && res.value.passed).toBe(false);
    if (res.isSuccess) expect(res.value.failures[0].errorMessage).toContain('SyntaxError');
  });

  it('passes a malicious scope as literal argv tokens, never as a shell string', async () => {
    const fs = vitestProject();
    const runner = fakeRunner(fs, () => ({ stdout: '', stderr: '', exitCode: 0, success: true, report: JSON.stringify({ numTotalTests: 0, testResults: [] }) }));
    await new QARunnerService(runner, fs).runQA({ stack: 'node', cwd: PROJECT, scope: '; rm -rf / && echo pwned' });

    expect(runner.calls[0].command).toBe('npx');
    expect(runner.calls[0].args.slice(-7)).toEqual([';', 'rm', '-rf', '/', '&&', 'echo', 'pwned']);
    expect(runner.calls[0].options.bucketKey).toBe('node:test');
  });

  it('falls back to the next interpreter when pytest is not on PATH', async () => {
    const fs = new InMemoryFileSystem();
    const junit = `<testsuites><testsuite name="pytest" errors="0" failures="0" tests="1"><testcase classname="tests.test_x" name="test_ok" /></testsuite></testsuites>`;
    const runner = fakeRunner(fs, (call) =>
      call.command === 'pytest'
        ? { stdout: '', stderr: 'spawn pytest ENOENT', exitCode: 1, success: false, failureKind: 'not_found' }
        : { stdout: '1 passed', stderr: '', exitCode: 0, success: true, report: junit }
    );
    const res = await new QARunnerService(runner, fs).runQA({ stack: 'python', cwd: PROJECT });
    expect(runner.calls.map((c) => c.command)).toEqual(['pytest', 'python']);
    expect(res.isSuccess && res.value.passed).toBe(true);
  });

  it('reports a check whose tool is missing as skipped, never as passed', async () => {
    const fs = new InMemoryFileSystem();
    const runner = fakeRunner(fs, () => ({ stdout: '', stderr: 'not found', exitCode: 1, success: false, failureKind: 'not_found' }));
    const res = await new QARunnerService(runner, fs).runCheck({ stack: 'go', cwd: PROJECT }, 'lint');
    expect(res.isSuccess).toBe(true);
    if (res.isSuccess) {
      expect(res.value.status).toBe('skipped');
      expect(res.value.passed).toBe(false);
    }
  });

  it('skips typecheck for a JS project without tsconfig.json', async () => {
    const fs = vitestProject();
    const runner = fakeRunner(fs, () => ({ stdout: '', stderr: '', exitCode: 0, success: true }));
    const res = await new QARunnerService(runner, fs).runCheck({ stack: 'node', cwd: PROJECT }, 'typecheck');
    expect(res.isSuccess && res.value.status).toBe('skipped');
    expect(runner.calls).toHaveLength(0);
  });

  it('turns tsc diagnostics into structured failures', async () => {
    const fs = vitestProject();
    await fs.writeFile(path.join(PROJECT, 'tsconfig.json'), '{}');
    const runner = fakeRunner(fs, () => ({
      stdout: "src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.\n",
      stderr: '',
      exitCode: 2,
      success: false,
      failureKind: 'exit_code',
    }));
    const res = await new QARunnerService(runner, fs).runCheck({ stack: 'node', cwd: PROJECT }, 'typecheck');
    expect(res.isSuccess).toBe(true);
    if (res.isSuccess) {
      expect(res.value.failures[0]).toMatchObject({ file: 'src/a.ts', line: 3 });
      expect(res.value.failures[0].errorMessage).toContain('TS2322');
    }
  });

  it('surfaces an open circuit as an error instead of a fake test result', async () => {
    const fs = vitestProject();
    const runner = fakeRunner(fs, () => ({ stdout: '', stderr: 'Circuit breaker is OPEN', exitCode: 999, success: false, failureKind: 'circuit_open' }));
    const res = await new QARunnerService(runner, fs).runQA({ stack: 'node', cwd: PROJECT });
    expect(res.isFailure).toBe(true);
  });
});
