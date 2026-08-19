import { IProcessRunner } from '../../../shared/infrastructure/process_runner.js';
import { Result, ok, fail } from '../../../shared/domain/result.js';
import { QARunnerOptions, QAResult, TestFailureDetails } from '../domain/qa_types.js';
import { SupportedStack } from '../../state_management/domain/state_types.js';

export class QARunnerService {
  constructor(private readonly processRunner: IProcessRunner) {}

  async runQA(options: QARunnerOptions): Promise<Result<QAResult, Error>> {
    try {
      const { cmd, args } = this.getCommandForStack(options.stack, options.scope);
      const execution = await this.processRunner.runCommand(cmd, args, options.cwd, options.stack);
      const failures = this.parseFailures(options.stack, execution.stdout, execution.stderr);
      const passed = execution.success && failures.length === 0;

      return ok({
        stack: options.stack,
        passed,
        totalTests: failures.length > 0 ? failures.length + 1 : 1,
        failedTestsCount: failures.length,
        failures,
        rawStdout: execution.stdout,
        rawStderr: execution.stderr,
      });
    } catch (error: any) {
      return fail(new Error(`QA Runner execution failed: ${error.message}`));
    }
  }

  /**
   * Returns a base executable plus a discrete argv array (never a shell string): scope
   * tokens land as literal args to the test runner, so shell metacharacters in `scope`
   * have no special meaning — there is no shell to interpret them.
   */
  private getCommandForStack(stack: SupportedStack, scope?: string): { cmd: string; args: string[] } {
    const scopeArgs = scope ? scope.trim().split(/\s+/).filter(Boolean) : [];
    switch (stack) {
      case 'elixir': return { cmd: 'mix', args: ['test', ...scopeArgs] };
      case 'dotnet': return { cmd: 'dotnet', args: ['test', ...scopeArgs] };
      case 'node': return { cmd: 'npx', args: ['vitest', 'run', ...scopeArgs] };
      case 'laravel': return { cmd: 'php', args: ['artisan', 'test', ...scopeArgs] };
      case 'rust': return { cmd: 'cargo', args: ['test', ...scopeArgs] };
      case 'python': return { cmd: 'pytest', args: [...scopeArgs] };
      case 'go': return { cmd: 'go', args: ['test', './...', ...scopeArgs] };
      case 'flutter': return { cmd: 'flutter', args: ['test', ...scopeArgs] };
      case 'ruby': return { cmd: 'bundle', args: ['exec', 'rspec', ...scopeArgs] };
      case 'react':
      case 'reactnative': return { cmd: 'npm', args: ['test', ...scopeArgs] };
      default: return { cmd: 'npm', args: ['test', ...scopeArgs] };
    }
  }

  private parseFailures(stack: SupportedStack, stdout: string, stderr: string): TestFailureDetails[] {
    const failures: TestFailureDetails[] = [];
    const combined = `${stdout}\n${stderr}`;
    if (combined.includes('FAIL') || combined.includes('Failed') || combined.includes('error:')) {
      const lines = combined.split('\n').filter((l) => l.includes('FAIL') || l.includes('Error') || l.includes('AssertionError'));
      for (const line of lines.slice(0, 5)) {
        failures.push({ file: this.extractFilePath(line), errorMessage: line.trim(), rawOutput: combined });
      }
    }
    return failures;
  }

  private extractFilePath(line: string): string | undefined {
    const match = line.match(/[.\w/\\-]+\.(ts|tsx|js|jsx|py|rs|go|rb|exs?|cs|dart|php)\b/);
    return match ? match[0] : undefined;
  }
}
