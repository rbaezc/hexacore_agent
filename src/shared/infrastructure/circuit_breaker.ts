import { IProcessRunner, ProcessExecutionResult } from './process_runner.js';
import { SecuritySandboxGuard } from './security_sandbox.js';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeoutMs: number;
}

interface BreakerState {
  failureCount: number;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  lastStateChange: number;
}

const DEFAULT_BUCKET = 'default';

export class ResilientProcessRunner implements IProcessRunner {
  private readonly breakers = new Map<string, BreakerState>();

  constructor(
    private readonly innerRunner: IProcessRunner,
    private readonly options: CircuitBreakerOptions = { failureThreshold: 3, resetTimeoutMs: 10000 }
  ) {}

  async runCommand(
    command: string,
    args: string[] = [],
    cwd?: string,
    bucketKey: string = DEFAULT_BUCKET
  ): Promise<ProcessExecutionResult> {
    const securityCheck = SecuritySandboxGuard.validateInvocation(command, args);
    if (securityCheck.isFailure) {
      return {
        stdout: '',
        stderr: securityCheck.error.message,
        exitCode: 403,
        success: false,
      };
    }

    const breaker = this.getBreaker(bucketKey);

    if (breaker.state === 'OPEN') {
      if (Date.now() - breaker.lastStateChange > this.options.resetTimeoutMs) {
        breaker.state = 'HALF_OPEN';
      } else {
        return {
          stdout: '',
          stderr: `Circuit breaker is OPEN for '${bucketKey}'. Command execution rejected for system stability.`,
          exitCode: 999,
          success: false,
        };
      }
    }

    const result = await this.innerRunner.runCommand(command, args, cwd);

    if (!result.success) {
      breaker.failureCount++;
      if (breaker.failureCount >= this.options.failureThreshold) {
        breaker.state = 'OPEN';
        breaker.lastStateChange = Date.now();
      }
    } else {
      breaker.failureCount = 0;
      breaker.state = 'CLOSED';
    }

    return result;
  }

  private getBreaker(key: string): BreakerState {
    let breaker = this.breakers.get(key);
    if (!breaker) {
      breaker = { failureCount: 0, state: 'CLOSED', lastStateChange: Date.now() };
      this.breakers.set(key, breaker);
    }
    return breaker;
  }
}
