import { QARunnerService } from './qa_runner_service.js';
import { QARunnerOptions, QAFixAttempt, QAResult } from '../domain/qa_types.js';
import { Result, ok, fail } from '../../../shared/domain/result.js';
import { ChangeJournal } from '../../../shared/infrastructure/change_journal.js';

export interface PatchOutcome {
  applied: boolean;
  summary: string;
  checkpointId?: string;
  files?: string[];
}

export interface CodePatcher {
  applyFix(failure: QAResult, context?: { rules?: string; cwd?: string }): Promise<PatchOutcome>;
}

export interface QALoopOutcome {
  attempts: QAFixAttempt[];
  finalResult: QAResult;
}

/**
 * Test → patch → re-test. Red tests are a normal outcome (returned as `ok` with
 * `finalResult.passed === false`); only infrastructure problems surface as `fail`.
 * A patch that makes things worse is rolled back before the loop stops.
 */
export class QAAutonomousLoop {
  constructor(
    private readonly qaRunner: QARunnerService,
    private readonly maxRetries: number = 3,
    private readonly journal?: ChangeJournal
  ) {}

  async runAutonomousLoop(
    options: QARunnerOptions,
    patcher?: CodePatcher,
    rules?: string
  ): Promise<Result<QALoopOutcome, Error>> {
    const attempts: QAFixAttempt[] = [];
    let previous: { result: QAResult; checkpointId?: string } | undefined;

    for (let iteration = 1; iteration <= this.maxRetries; iteration++) {
      const qaResult = await this.qaRunner.runQA(options);
      if (qaResult.isFailure) return fail(qaResult.error);
      const current = qaResult.value;

      if (current.passed) {
        attempts.push({ iteration, status: 'passed', failedTestsCount: 0, message: 'All tests passed.' });
        return ok({ attempts, finalResult: current });
      }

      if (previous?.checkpointId && current.failedTestsCount > previous.result.failedTestsCount && this.journal) {
        const rollback = await this.journal.rollback(previous.checkpointId);
        attempts.push({
          iteration,
          status: 'rolled_back',
          failedTestsCount: current.failedTestsCount,
          checkpointId: previous.checkpointId,
          message: rollback.isSuccess && rollback.value.applied
            ? `Patch increased failures (${previous.result.failedTestsCount} → ${current.failedTestsCount}); it was rolled back.`
            : `Patch increased failures; automatic rollback was not possible — use rollback_changes on ${previous.checkpointId}.`,
        });
        return ok({ attempts, finalResult: previous.result });
      }

      attempts.push({
        iteration,
        status: 'failed',
        failedTestsCount: current.failedTestsCount,
        message: `${current.failedTestsCount} failing test(s).`,
      });

      if (!patcher || iteration === this.maxRetries) return ok({ attempts, finalResult: current });

      const patch = await patcher.applyFix(current, { rules, cwd: options.cwd });
      if (!patch.applied) {
        attempts.push({ iteration, status: 'patch_rejected', message: patch.summary });
        return ok({ attempts, finalResult: current });
      }
      attempts.push({ iteration, status: 'patched', checkpointId: patch.checkpointId, message: `${patch.summary} (files: ${(patch.files ?? []).join(', ')})` });
      previous = { result: current, checkpointId: patch.checkpointId };
    }

    // Unreachable: the last iteration always returns above.
    return fail(new Error('QA loop exited unexpectedly.'));
  }
}
