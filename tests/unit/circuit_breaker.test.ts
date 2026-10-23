import { describe, it, expect } from 'vitest';
import { ResilientProcessRunner } from '../../src/shared/infrastructure/circuit_breaker.js';
import { IProcessRunner, ProcessExecutionResult } from '../../src/shared/infrastructure/process_runner.js';

const passing: ProcessExecutionResult = { stdout: 'ok', stderr: '', exitCode: 0, success: true };
const redTests: ProcessExecutionResult = { stdout: '1 failed', stderr: '', exitCode: 1, success: false, failureKind: 'exit_code' };
const timeout: ProcessExecutionResult = { stdout: '', stderr: 'timeout', exitCode: 1, success: false, failureKind: 'timeout' };

function scripted(results: ProcessExecutionResult[]): IProcessRunner & { calls: number } {
  const runner = {
    calls: 0,
    async runCommand() {
      return results[Math.min(runner.calls++, results.length - 1)];
    },
  };
  return runner;
}

describe('ResilientProcessRunner', () => {
  it('blocks an allowlisted command with a disallowed argument pattern', async () => {
    const runner = new ResilientProcessRunner(scripted([passing]));
    const result = await runner.runCommand('npm', ['test', '&&', 'rm', '-rf', '/']);
    expect(result.exitCode).toBe(403);
    expect(result.failureKind).toBe('blocked');
  });

  it('never opens the circuit for failing tests (a non-zero exit is a normal outcome)', async () => {
    const inner = scripted([redTests]);
    const runner = new ResilientProcessRunner(inner, { failureThreshold: 3, resetTimeoutMs: 10_000 });
    for (let i = 0; i < 6; i++) await runner.runCommand('mix', ['test'], { bucketKey: 'elixir' });
    expect(inner.calls).toBe(6);
    expect(runner.getState('elixir')).toBe('CLOSED');
  });

  it('opens the circuit after repeated infrastructure failures, only for that bucket', async () => {
    const runner = new ResilientProcessRunner(scripted([timeout]), { failureThreshold: 3, resetTimeoutMs: 10_000 });
    for (let i = 0; i < 3; i++) await runner.runCommand('mix', ['test'], { bucketKey: 'elixir' });

    const rejected = await runner.runCommand('mix', ['test'], { bucketKey: 'elixir' });
    expect(rejected.failureKind).toBe('circuit_open');
    expect(rejected.stderr).toContain('infrastructure failures');
    expect(runner.getState('rust')).toBe('CLOSED');
  });

  it('half-opens after the reset timeout and closes again on success', async () => {
    const inner = scripted([timeout, timeout, passing]);
    const runner = new ResilientProcessRunner(inner, { failureThreshold: 2, resetTimeoutMs: 0 });
    await runner.runCommand('go', ['test'], { bucketKey: 'go' });
    await runner.runCommand('go', ['test'], { bucketKey: 'go' });
    expect(runner.getState('go')).toBe('OPEN');

    await new Promise((r) => setTimeout(r, 5));
    const result = await runner.runCommand('go', ['test'], { bucketKey: 'go' });
    expect(result.success).toBe(true);
    expect(runner.getState('go')).toBe('CLOSED');
  });
});
