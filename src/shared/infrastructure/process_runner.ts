import spawn from 'cross-spawn';

export interface ProcessExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
}

export interface IProcessRunner {
  /** bucketKey is only meaningful to circuit-breaker-aware implementations; plain runners ignore it. */
  runCommand(command: string, args?: string[], cwd?: string, bucketKey?: string): Promise<ProcessExecutionResult>;
}

const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

export class NodeProcessRunner implements IProcessRunner {
  constructor(private readonly timeoutMs: number = 120_000) {}

  /**
   * Spawns without a shell (via cross-spawn, which safely resolves Windows .cmd/.bat
   * shims like npm/npx) so argv is never re-parsed/interpreted — closes shell
   * metacharacter injection regardless of what a caller-supplied arg contains.
   */
  async runCommand(command: string, args: string[] = [], cwd?: string): Promise<ProcessExecutionResult> {
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn(command, args, { cwd: cwd || process.cwd(), env: process.env });
      } catch (error: any) {
        resolve({ stdout: '', stderr: error.message || String(error), exitCode: 1, success: false });
        return;
      }

      let stdout = '';
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        stderr += `\nProcess exceeded timeout of ${this.timeoutMs}ms and was terminated.`;
        child.kill('SIGKILL');
      }, this.timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        if (stdout.length < MAX_BUFFER_BYTES) stdout += chunk.toString();
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < MAX_BUFFER_BYTES) stderr += chunk.toString();
      });

      child.on('error', (error: NodeJS.ErrnoException) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ stdout, stderr: stderr || error.message, exitCode: 1, success: false });
      });

      child.on('close', (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const exitCode = code ?? 1;
        resolve({ stdout, stderr, exitCode, success: exitCode === 0 && signal === null });
      });
    });
  }
}
