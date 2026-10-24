import { SupportedStack } from '../../../shared/domain/stack.js';

/** Stack a lesson applies to; 'any' for cross-stack knowledge. */
export type LessonScope = SupportedStack | 'any';

/**
 * active = offered to the model; needs_review = evidence says it is not helping (still offered,
 * ranked lower, flagged for a rewrite); retired = kept on disk for history, never offered.
 */
export type LessonStatus = 'active' | 'needs_review' | 'retired';

export interface LessonStats {
  /** Times the lesson was offered (suggestions after a failure, knowledge searches). */
  retrieved: number;
  /** Failures that went green after the lesson was offered, plus explicit positive ratings. */
  helped: number;
  /** Failures that stayed red after it was offered, plus explicit negative ratings. */
  notHelped: number;
  lastUsedAt?: string;
}

/** Index entry; the lesson text itself lives in `.hexagen/skills/<slug>.md` (reviewable, versionable). */
export interface Lesson {
  id: string;
  slug: string;
  title: string;
  stack: LessonScope;
  tags: string[];
  /** One-line symptom description, used for skill descriptions and similarity checks. */
  problem: string;
  file: string;
  status: LessonStatus;
  version: number;
  /** Episodes (resolved failures) this lesson was distilled from. */
  episodeIds: string[];
  stats: LessonStats;
  /** Set once exported as a Claude Code skill. */
  exportedTo?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ObservedFailure {
  file?: string;
  line?: number;
  testName?: string;
  errorMessage: string;
}

/** What the learning loop needs from a QA result, without depending on the QA slice. */
export interface ObservedCheck {
  stack: SupportedStack;
  check: string;
  status: 'passed' | 'failed' | 'skipped';
  failures: ObservedFailure[];
}

/** A failure that is currently red for a stack/check/directory. */
export interface OpenFailure {
  key: string;
  stack: SupportedStack;
  check: string;
  cwd: string;
  signature: string;
  failures: ObservedFailure[];
  since: string;
  runs: number;
  /** Lessons offered while this failure was open; credited when it goes green. */
  offeredLessonIds: string[];
}

/** Experience: a failure that went from red to green. Raw material for lessons. */
export interface Episode {
  id: string;
  stack: SupportedStack;
  check: string;
  cwd: string;
  signature: string;
  failures: ObservedFailure[];
  failedSince: string;
  resolvedAt: string;
  runsToResolve: number;
  /** Lesson recorded from it, if any. */
  lessonId?: string;
  /** Lessons that were offered before it was resolved. */
  offeredLessonIds: string[];
}

export interface LearningStore {
  version: 1;
  lessons: Lesson[];
  episodes: Episode[];
  openFailures: OpenFailure[];
}

export interface LessonInput {
  title: string;
  stack?: LessonScope;
  /** When it applies: symptoms, error messages, situations. */
  problem: string;
  /** What to do, as concrete steps or rules. */
  solution: string;
  example?: string;
  tags?: string[];
  /** Episode this lesson was learned from (see review_lessons / run_quality_assurance). */
  episodeId?: string;
  /** Improve an existing lesson instead of creating one. Stats are kept. */
  updateId?: string;
}

export interface LessonSuggestion {
  id: string;
  title: string;
  stack: LessonScope;
  file: string;
  effectiveness: number;
  status: LessonStatus;
  content: string;
}

export interface LearningSummary {
  lessons: number;
  active: number;
  needsReview: { id: string; title: string; effectiveness: number }[];
  unlearnedEpisodes: { id: string; stack: SupportedStack; check: string; summary: string; recurrences: number }[];
  exportable: { id: string; title: string; effectiveness: number }[];
  topLessons: { id: string; title: string; stack: LessonScope; effectiveness: number }[];
}

/**
 * Port to the knowledge search: ranked sections of the markdown documents in `dir`, best first,
 * with each document's score multiplied by `boost(filePath)` (0 hides it).
 */
export type LessonSearch = (query: string, dir: string, boost: (filePath: string) => number) => Promise<{ sourceDoc: string }[]>;
