import { IProcessRunner, ProcessExecutionResult } from './process_runner.js';
import { SecuritySandboxGuard } from './security_sandbox.js';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeoutMs: number;
}

export class ResilientProcessRunner implements IProcessRunner {
  private failureCount = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private lastStateChange = Date.now();

  constructor(
    private readonly innerRunner: IProcessRunner,
    private readonly options: CircuitBreakerOptions = { failureThreshold: 3, resetTimeoutMs: 10000 }
  ) {}

  async runCommand(command: string, cwd?: string): Promise<ProcessExecutionResult> {
    const securityCheck = SecuritySandboxGuard.validateCommand(command);
    if (securityCheck.isFailure) {
      return {
        stdout: '',
        stderr: securityCheck.error.message,
        exitCode: 403,
        success: false,
      };
    }

    if (this.state === 'OPEN') {
      if (Date.now() - this.lastStateChange > this.options.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
      } else {
        return {
          stdout: '',
          stderr: 'Circuit breaker is OPEN. Command execution rejected for system stability.',
          exitCode: 999,
          success: false,
        };
      }
    }

    const result = await this.innerRunner.runCommand(command, cwd);

    if (!result.success) {
      this.failureCount++;
      if (this.failureCount >= this.options.failureThreshold) {
        this.state = 'OPEN';
        this.lastStateChange = Date.now();
      }
    } else {
      this.failureCount = 0;
      this.state = 'CLOSED';
    }

    return result;
  }
}
