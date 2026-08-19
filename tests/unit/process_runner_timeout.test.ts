import { describe, it, expect } from 'vitest';
import { NodeProcessRunner } from '../../src/shared/infrastructure/process_runner.js';

describe('NodeProcessRunner timeout', () => {
  it('should terminate a hung process instead of waiting forever', async () => {
    const runner = new NodeProcessRunner(300);

    const result = await runner.runCommand('node', ['-e', 'setTimeout(() => {}, 5000)']);

    expect(result.success).toBe(false);
    expect(result.stderr).toContain('exceeded timeout');
  }, 10_000);

  it('should not let shell metacharacters in args spawn a second process (no shell involved)', async () => {
    const runner = new NodeProcessRunner();

    const result = await runner.runCommand('node', ['--version', '&& echo INJECTED_MARKER']);

    expect(result.success).toBe(true);
    expect(result.stdout).not.toContain('INJECTED_MARKER');
  });
});
