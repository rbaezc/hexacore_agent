import spawn from 'cross-spawn';
import type { ChildProcess } from 'node:child_process';

/**
 * Why a process did not succeed. Only `spawn_error` and `timeout` say the *tooling* is
 * unhealthy; `exit_code` is the normal outcome of a failing test suite or compiler run.
 */
export type ProcessFailureKind = 'exit_code' | 'spawn_error' | 'not_found' | 'timeout' | 'blocked' | 'circuit_open';

export interface ProcessExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
  failureKind?: ProcessFailureKind;
  durationMs?: number;
}

export interface RunCommandOptions {
  cwd?: string;
  /** Circuit-breaker bucket; plain runners ignore it. */
  bucketKey?: string;
  /** Streams output chunks as they arrive (used for MCP progress notifications). */
  onOutput?: (chunk: string) => void;
}

export interface IProcessRunner {
  runCommand(command: string, args?: string[], options?: RunCommandOptions): Promise<ProcessExecutionResult>;
}

const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

export class NodeProcessRunner implements IProcessRunner {
  constructor(private readonly timeoutMs: number = 600_000) {}

  /**
   * Spawns without a shell (via cross-spawn, which safely resolves Windows .cmd/.bat
   * shims like npm/npx) so argv is never re-parsed/interpreted — closes shell
   * metacharacter injection regardless of what a caller-supplied arg contains.
   */
  async runCommand(command: string, args: string[] = [], options: RunCommandOptions = {}): Promise<ProcessExecutionResult> {
    const startedAt = Date.now();
    return new Promise((resolve) => {
      let child: ChildProcess;
      try {
        child = spawn(command, args, {
          cwd: options.cwd || process.cwd(),
          // Colour codes would corrupt every parser downstream.
          env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', CI: process.env.CI ?? '1' },
        });
      } catch (error: any) {
        resolve({ stdout: '', stderr: error.message || String(error), exitCode: 1, success: false, failureKind: 'spawn_error' });
        return;
      }

      let stdout = '';
      let stderr = '';
      let settled = false;
      let timedOut = false;

      const timer = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        stderr += `\nProcess exceeded timeout of ${this.timeoutMs}ms and was terminated.`;
        killTree(child);
      }, this.timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        if (stdout.length < MAX_BUFFER_BYTES) stdout += text;
        options.onOutput?.(text);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        if (stderr.length < MAX_BUFFER_BYTES) stderr += text;
        options.onOutput?.(text);
      });

      child.on('error', (error: NodeJS.ErrnoException) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          stdout,
          stderr: stderr || error.message,
          exitCode: 1,
          success: false,
          failureKind: error.code === 'ENOENT' ? 'not_found' : 'spawn_error',
          durationMs: Date.now() - startedAt,
        });
      });

      child.on('close', (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const exitCode = code ?? 1;
        const success = exitCode === 0 && signal === null && !timedOut;
        resolve({
          stdout,
          stderr,
          exitCode,
          success,
          failureKind: success ? undefined : timedOut ? 'timeout' : 'exit_code',
          durationMs: Date.now() - startedAt,
        });
      });
    });
  }
}

/** On Windows, killing the cmd.exe shim leaves the real runner alive; taskkill /T takes the whole tree. */
function killTree(child: ChildProcess): void {
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    return;
  }
  child.kill('SIGKILL');
}
