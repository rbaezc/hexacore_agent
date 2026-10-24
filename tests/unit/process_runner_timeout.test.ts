import { describe, it, expect } from 'vitest';
import { NodeProcessRunner } from '../../src/shared/infrastructure/process_runner.js';

describe('NodeProcessRunner', () => {
  it('terminates a hung process and classifies it as a timeout', async () => {
    const runner = new NodeProcessRunner(300);

    const result = await runner.runCommand('node', ['-e', 'setTimeout(() => {}, 5000)']);

    expect(result.success).toBe(false);
    expect(result.failureKind).toBe('timeout');
    expect(result.stderr).toContain('exceeded timeout');
  }, 10_000);

  it('does not let shell metacharacters in args spawn a second process (no shell involved)', async () => {
    const runner = new NodeProcessRunner();

    const result = await runner.runCommand('node', ['--version', '&& echo INJECTED_MARKER']);

    expect(result.success).toBe(true);
    expect(result.stdout).not.toContain('INJECTED_MARKER');
  });

  it('classifies a non-zero exit as exit_code, not as an infrastructure failure', async () => {
    const result = await new NodeProcessRunner().runCommand('node', ['-e', 'process.exit(3)']);
    expect(result.exitCode).toBe(3);
    expect(result.failureKind).toBe('exit_code');
  });

  it('classifies a missing executable as not_found', async () => {
    const result = await new NodeProcessRunner().runCommand('definitely-not-a-real-binary-hexacore', []);
    expect(result.success).toBe(false);
    expect(result.failureKind).toBe('not_found');
  });

  it('streams output chunks while the process runs', async () => {
    const chunks: string[] = [];
    await new NodeProcessRunner().runCommand('node', ['-e', 'console.log("hello-stream")'], { onOutput: (c) => chunks.push(c) });
    expect(chunks.join('')).toContain('hello-stream');
  });
});
