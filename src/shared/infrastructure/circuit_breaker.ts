import { IProcessRunner, ProcessExecutionResult, ProcessFailureKind, RunCommandOptions } from './process_runner.js';
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

/**
 * Failures that mean the toolchain itself is unhealthy. A non-zero exit code is NOT one
 * of them: red tests are the expected state while fixing code and must never trip the breaker.
 */
const INFRASTRUCTURE_FAILURES: ReadonlySet<ProcessFailureKind> = new Set(['spawn_error', 'timeout']);

export class ResilientProcessRunner implements IProcessRunner {
  private readonly breakers = new Map<string, BreakerState>();

  constructor(
    private readonly innerRunner: IProcessRunner,
    private readonly options: CircuitBreakerOptions = { failureThreshold: 3, resetTimeoutMs: 30_000 }
  ) {}

  async runCommand(command: string, args: string[] = [], options: RunCommandOptions = {}): Promise<ProcessExecutionResult> {
    const securityCheck = SecuritySandboxGuard.validateInvocation(command, args);
    if (securityCheck.isFailure) {
      return { stdout: '', stderr: securityCheck.error.message, exitCode: 403, success: false, failureKind: 'blocked' };
    }

    const bucketKey = options.bucketKey ?? DEFAULT_BUCKET;
    const breaker = this.getBreaker(bucketKey);

    if (breaker.state === 'OPEN') {
      if (Date.now() - breaker.lastStateChange > this.options.resetTimeoutMs) {
        breaker.state = 'HALF_OPEN';
      } else {
        return {
          stdout: '',
          stderr: `Circuit breaker is OPEN for '${bucketKey}' after ${breaker.failureCount} consecutive infrastructure failures (spawn errors/timeouts). Retry in ${Math.ceil((this.options.resetTimeoutMs - (Date.now() - breaker.lastStateChange)) / 1000)}s.`,
          exitCode: 999,
          success: false,
          failureKind: 'circuit_open',
        };
      }
    }

    const result = await this.innerRunner.runCommand(command, args, options);

    if (result.failureKind && INFRASTRUCTURE_FAILURES.has(result.failureKind)) {
      breaker.failureCount++;
      if (breaker.state === 'HALF_OPEN' || breaker.failureCount >= this.options.failureThreshold) {
        breaker.state = 'OPEN';
        breaker.lastStateChange = Date.now();
      }
    } else {
      breaker.failureCount = 0;
      breaker.state = 'CLOSED';
    }

    return result;
  }

  getState(bucketKey: string = DEFAULT_BUCKET): BreakerState['state'] {
    return this.getBreaker(bucketKey).state;
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
