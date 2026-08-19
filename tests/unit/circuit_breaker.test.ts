import { describe, it, expect } from 'vitest';
import { ResilientProcessRunner } from '../../src/shared/infrastructure/circuit_breaker.js';
import { IProcessRunner, ProcessExecutionResult } from '../../src/shared/infrastructure/process_runner.js';

class AlwaysPassingRunner implements IProcessRunner {
  async runCommand(): Promise<ProcessExecutionResult> {
    return { stdout: 'ok', stderr: '', exitCode: 0, success: true };
  }
}

describe('ResilientProcessRunner', () => {
  it('should block an allowlisted command with a disallowed argument pattern', async () => {
    const runner = new ResilientProcessRunner(new AlwaysPassingRunner());
    const result = await runner.runCommand('npm', ['test', '&&', 'rm', '-rf', '/']);
    expect(result.exitCode).toBe(403);
  });

  it('should open the circuit only for the failing bucket, leaving other buckets closed', async () => {
    let mode: 'fail' | 'pass' = 'fail';
    const switchableRunner: IProcessRunner = {
      async runCommand() {
        return mode === 'fail'
          ? { stdout: '', stderr: 'boom', exitCode: 1, success: false }
          : { stdout: 'ok', stderr: '', exitCode: 0, success: true };
      },
    };
    const runner = new ResilientProcessRunner(switchableRunner, { failureThreshold: 3, resetTimeoutMs: 10_000 });

    for (let i = 0; i < 3; i++) {
      await runner.runCommand('mix', ['test'], undefined, 'elixir');
    }
    const openResult = await runner.runCommand('mix', ['test'], undefined, 'elixir');
    expect(openResult.exitCode).toBe(999);

    mode = 'pass';
    const cargoResult = await runner.runCommand('cargo', ['test'], undefined, 'rust');
    expect(cargoResult.success).toBe(true);
  });
});
