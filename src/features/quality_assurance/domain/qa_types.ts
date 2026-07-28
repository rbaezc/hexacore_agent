import { SupportedStack } from '../../state_management/domain/state_types.js';

export interface QARunnerOptions {
  stack: SupportedStack;
  scope?: string;
  cwd?: string;
}

export interface TestFailureDetails {
  file?: string;
  testName?: string;
  errorMessage: string;
  rawOutput: string;
}

export interface QAResult {
  stack: SupportedStack;
  passed: boolean;
  totalTests: number;
  failedTestsCount: number;
  failures: TestFailureDetails[];
  rawStdout: string;
  rawStderr: string;
}

export interface QAFixAttempt {
  iteration: number;
  status: 'fixed' | 'failed';
  message: string;
}
