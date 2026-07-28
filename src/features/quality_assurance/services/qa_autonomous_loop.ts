import { QARunnerService } from './qa_runner_service.js';
import { QARunnerOptions, QAFixAttempt, QAResult } from '../domain/qa_types.js';
import { Result, ok, fail } from '../../../shared/domain/result.js';

export interface CodePatcher {
  applyFix(failure: QAResult): Promise<boolean>;
}

export class QAAutonomousLoop {
  constructor(
    private readonly qaRunner: QARunnerService,
    private readonly maxRetries: number = 3
  ) {}

  async runAutonomousLoop(
    options: QARunnerOptions,
    patcher?: CodePatcher
  ): Promise<Result<{ attempts: QAFixAttempt[]; finalResult: QAResult }, Error>> {
    const attempts: QAFixAttempt[] = [];

    for (let iteration = 1; iteration <= this.maxRetries; iteration++) {
      const qaResult = await this.qaRunner.runQA(options);
      if (qaResult.isFailure) return fail(qaResult.error);

      if (qaResult.value.passed) {
        attempts.push({
          iteration,
          status: 'fixed',
          message: 'All quality assurance tests passed successfully.',
        });
        return ok({ attempts, finalResult: qaResult.value });
      }

      attempts.push({
        iteration,
        status: 'failed',
        message: `Iteration ${iteration} failed with ${qaResult.value.failedTestsCount} failing test(s).`,
      });

      if (patcher) {
        const patchApplied = await patcher.applyFix(qaResult.value);
        if (!patchApplied) {
          return fail(new Error(`Patcher could not auto-resolve failures on iteration ${iteration}.`));
        }
      } else {
        // If no automated patcher is passed, break after reporting failures
        return ok({ attempts, finalResult: qaResult.value });
      }
    }

    return fail(new Error(`QA Autonomous loop reached max retries (${this.maxRetries}) without full resolution.`));
  }
}
