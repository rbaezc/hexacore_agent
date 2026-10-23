import { SupportedStack } from '../../../shared/domain/stack.js';

export type QACheck = 'test' | 'typecheck' | 'lint' | 'build';

export interface QARunnerOptions {
  stack: SupportedStack;
  scope?: string;
  /** Absolute directory to run in (resolved and sandboxed by the caller). */
  cwd?: string;
  onOutput?: (chunk: string) => void;
}

export interface TestFailureDetails {
  file?: string;
  line?: number;
  testName?: string;
  errorMessage: string;
}

/** How the result was obtained — lets the caller know how much to trust the counts. */
export type ReportFormat = 'json' | 'junit' | 'trx' | 'text' | 'heuristic';

export interface QAResult {
  stack: SupportedStack;
  check: QACheck;
  /** 'skipped' = the check does not apply or its tool is not installed (see skipReason). */
  status: 'passed' | 'failed' | 'skipped';
  passed: boolean;
  command: string;
  reportFormat: ReportFormat;
  totalTests: number;
  passedTests: number;
  failedTestsCount: number;
  skippedTests: number;
  failures: TestFailureDetails[];
  skipReason?: string;
  durationMs?: number;
  /** Output tails only: full logs of a large suite would swamp the model's context. */
  rawStdout: string;
  rawStderr: string;
}

export interface QAFixAttempt {
  iteration: number;
  status: 'passed' | 'failed' | 'patched' | 'patch_rejected' | 'rolled_back';
  failedTestsCount?: number;
  message: string;
  checkpointId?: string;
}

/** Parsed counts + failures, independent of how they were extracted. */
export interface ParsedReport {
  format: ReportFormat;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  failures: TestFailureDetails[];
}
