import { Result } from '../../../shared/domain/result.js';
import { AttachedImage } from '../../../shared/domain/attachments.js';
import { SupportedStack } from '../../../shared/domain/stack.js';

export type QACheck = 'test' | 'typecheck' | 'lint' | 'build' | 'ui';

/** Checks that run the stack's own toolchain ('ui' audits pages instead, see UiCheckPort). */
export const TOOLCHAIN_CHECKS = ['test', 'typecheck', 'lint', 'build'] as const;
export type ToolchainCheck = (typeof TOOLCHAIN_CHECKS)[number];

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
export type ReportFormat = 'json' | 'junit' | 'trx' | 'text' | 'heuristic' | 'audit';

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
  /** What a 'ui' check audited (a prototype, a page or a local URL). */
  target?: string;
  /** Problems worth fixing that don't fail the check. */
  warnings?: TestFailureDetails[];
  /** Files the check produced, e.g. screenshots. */
  artifacts?: string[];
  /** Context on partial runs, e.g. why the browser part of a 'ui' check was skipped. */
  notes?: string[];
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

/** Outcome of auditing UI for the 'ui' check. */
export interface UiCheckOutcome {
  target: string;
  command: string;
  total: number;
  failures: TestFailureDetails[];
  warnings: TestFailureDetails[];
  artifacts: string[];
  notes: string[];
  images: AttachedImage[];
}

/** Audits pages for the 'ui' check; provided by the prototyping slice through the composition root. */
export interface UiCheckPort {
  audit(target: string | undefined): Promise<Result<UiCheckOutcome, Error>>;
}
