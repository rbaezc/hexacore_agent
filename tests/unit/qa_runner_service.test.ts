import { describe, it, expect } from 'vitest';
import { QARunnerService } from '../../src/features/quality_assurance/services/qa_runner_service.js';
import { IProcessRunner, ProcessExecutionResult } from '../../src/shared/infrastructure/process_runner.js';

class MockProcessRunner implements IProcessRunner {
  constructor(private readonly shouldPass: boolean) {}

  async runCommand(): Promise<ProcessExecutionResult> {
    if (this.shouldPass) {
      return {
        stdout: 'Tests: 5 passed, 5 total',
        stderr: '',
        exitCode: 0,
        success: true,
      };
    }
    return {
      stdout: 'FAIL src/payment.test.ts\nAssertionError: expected true to be false',
      stderr: 'Error running suite',
      exitCode: 1,
      success: false,
    };
  }
}

describe('QARunnerService', () => {
  it('should parse passing test output correctly', async () => {
    const runner = new QARunnerService(new MockProcessRunner(true));
    const result = await runner.runQA({ stack: 'node' });

    expect(result.isSuccess).toBe(true);
    if (result.isSuccess) {
      expect(result.value.passed).toBe(true);
      expect(result.value.failedTestsCount).toBe(0);
    }
  });

  it('should parse failing test output and extract failure details', async () => {
    const runner = new QARunnerService(new MockProcessRunner(false));
    const result = await runner.runQA({ stack: 'node' });

    expect(result.isSuccess).toBe(true);
    if (result.isSuccess) {
      expect(result.value.passed).toBe(false);
      expect(result.value.failures.length).toBeGreaterThan(0);
    }
  });
});
