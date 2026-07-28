import { IProcessRunner } from '../../../shared/infrastructure/process_runner.js';
import { Result, ok, fail } from '../../../shared/domain/result.js';
import { QARunnerOptions, QAResult, TestFailureDetails } from '../domain/qa_types.js';
import { SupportedStack } from '../../state_management/domain/state_types.js';

export class QARunnerService {
  constructor(private readonly processRunner: IProcessRunner) {}

  async runQA(options: QARunnerOptions): Promise<Result<QAResult, Error>> {
    try {
      const command = this.getCommandForStack(options.stack, options.scope);
      const execution = await this.processRunner.runCommand(command, options.cwd);
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

  private getCommandForStack(stack: SupportedStack, scope?: string): string {
    const s = scope ? ` ${scope}` : '';
    switch (stack) {
      case 'elixir': return `mix test${s}`;
      case 'dotnet': return `dotnet test${s}`;
      case 'node': return `npx vitest run${s}`;
      case 'laravel': return `php artisan test${s}`;
      case 'rust': return `cargo test${s}`;
      case 'python': return `pytest${s}`;
      case 'go': return `go test ./...${s}`;
      case 'flutter': return `flutter test${s}`;
      case 'ruby': return `bundle exec rspec${s}`;
      case 'react':
      case 'reactnative': return `npm test${s}`;
      default: return `npm test${s}`;
    }
  }

  private parseFailures(stack: SupportedStack, stdout: string, stderr: string): TestFailureDetails[] {
    const failures: TestFailureDetails[] = [];
    const combined = `${stdout}\n${stderr}`;
    if (combined.includes('FAIL') || combined.includes('Failed') || combined.includes('error:')) {
      const lines = combined.split('\n').filter((l) => l.includes('FAIL') || l.includes('Error') || l.includes('AssertionError'));
      for (const line of lines.slice(0, 5)) {
        failures.push({ errorMessage: line.trim(), rawOutput: combined });
      }
    }
    return failures;
  }
}
