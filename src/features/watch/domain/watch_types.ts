import { Result } from '../../../shared/domain/result.js';

/** Language of alerts (titles, bodies and what is spoken). */
export type WatchLang = 'en' | 'es';

export type WatchedStatus = 'passed' | 'failed' | 'skipped';

export interface WatchedFailure {
  file?: string;
  line?: number;
  testName?: string;
  errorMessage: string;
}

/** One check of one stack, as the watcher needs it (adapted from QA results by the caller). */
export interface WatchedResult {
  stack: string;
  check: string;
  status: WatchedStatus;
  failed: number;
  total: number;
  failures: WatchedFailure[];
  skipReason?: string;
  durationMs?: number;
}

/**
 * How a check moved between two runs.
 * broke/fixed are the transitions worth interrupting the user for; the first run reports
 * baseline_failing (also worth it) or baseline_ok; still_failing only goes to the log.
 */
export type TransitionKind = 'broke' | 'fixed' | 'still_failing' | 'baseline_failing' | 'baseline_ok';

export interface Transition {
  kind: TransitionKind;
  result: WatchedResult;
  previous?: WatchedStatus;
}

export interface WatchAlert {
  kind: TransitionKind;
  level: 'error' | 'success' | 'info';
  /** true = interrupt the user (desktop notification, voice); false = log only. */
  important: boolean;
  title: string;
  body: string;
  /** Short sentence meant to be read aloud. */
  spoken: string;
}

export interface Notifier {
  readonly name: string;
  /** Verbose notifiers (the terminal) also receive the alerts that are not important. */
  readonly verbose?: boolean;
  notify(alert: WatchAlert): Promise<void>;
}

/** Reports changed paths relative to the watched root, with forward slashes. */
export interface FileWatcher {
  start(onChange: (relPath: string) => void): void;
  stop(): void;
}

/** Runs the watched checks; `changed` lists the paths that triggered the run (empty for the first run). */
export type CheckRunner = (changed: string[]) => Promise<Result<WatchedResult[], Error>>;
