import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface ProcessExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
}

export interface IProcessRunner {
  runCommand(command: string, cwd?: string): Promise<ProcessExecutionResult>;
}

export class NodeProcessRunner implements IProcessRunner {
  async runCommand(command: string, cwd?: string): Promise<ProcessExecutionResult> {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: cwd || process.cwd(),
        env: { ...process.env },
        maxBuffer: 10 * 1024 * 1024,
      });
      return {
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        exitCode: 0,
        success: true,
      };
    } catch (error: any) {
      return {
        stdout: error.stdout ? error.stdout.toString() : '',
        stderr: error.stderr ? error.stderr.toString() : error.message || String(error),
        exitCode: typeof error.code === 'number' ? error.code : 1,
        success: false,
      };
    }
  }
}
