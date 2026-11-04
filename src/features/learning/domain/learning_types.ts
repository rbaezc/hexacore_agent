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
  /** Project lessons: the library lesson it was shared as, and the version shared. */
  sharedAs?: string;
  sharedVersion?: number;
  /** Library lessons: projects that contributed it or were helped by it. */
  projects?: string[];
  /** Set when the lesson was merged into another one (it is retired). */
  mergedInto?: string;
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
  /** Files the fix changed, when a snapshot from the red run was available. */
  changedFiles?: string[];
  /** How the offered lessons were judged (see FixAttribution). */
  attribution?: FixAttribution;
  /** Offered lessons whose content matches the fix (or all of them, without a diff). */
  creditedLessonIds?: string[];
}

/**
 * diff: the fix was compared with each offered lesson; only matching lessons are credited.
 * correlational: no snapshot of the red state (e.g. the server restarted); every offered lesson is credited.
 * no_change: the check went green without any file changing (flaky or environmental); nobody is credited.
 */
export type FixAttribution = 'diff' | 'correlational' | 'no_change';

/** What changed between the red run and the green run. */
export interface FixDiff {
  changedFiles: string[];
  /** Added and removed lines of the changed files. */
  changedText: string;
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

/** project = this workspace's lessons; library = the user's lessons shared from other projects. */
export type LessonOrigin = 'project' | 'library';

export interface MergeInput {
  /** The lesson that survives; it gets the merged evidence and history. */
  keepId: string;
  /** Lessons folded into it; they are retired. */
  mergeIds: string[];
  /** Optional rewrite of the surviving lesson (otherwise its text is kept). */
  title?: string;
  problem?: string;
  solution?: string;
  example?: string;
  tags?: string[];
}

export interface LessonSuggestion {
  id: string;
  origin: LessonOrigin;
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
  /** Pairs of live lessons that say nearly the same thing: merge them with merge_lessons. */
  duplicates: { ids: [string, string]; titles: [string, string]; similarity: number }[];
  /** Live lessons nobody has used or rewritten for a long time: still accurate? */
  stale: { id: string; title: string; idleDays: number }[];
  /** Proven project lessons not yet shared with the library, or changed since they were shared. */
  shareable: { id: string; title: string; effectiveness: number }[];
  /** Library lessons available to this project's stacks. */
  library?: { lessons: number; topLessons: { id: string; title: string; stack: LessonScope; effectiveness: number }[] };
}

/** Where a set of lessons lives: the project (`.hexagen/`) or the user's library (`~/.hexacore/`). */
export interface LessonLocation {
  /** Base that `Lesson.file` is relative to. */
  root: () => string;
  skillsDir: () => string;
}

/**
 * Port to the knowledge search: ranked sections of the markdown documents in `dir`, best first,
 * with each document's score multiplied by `boost(filePath)` (0 hides it).
 */
export type LessonSearch = (query: string, dir: string, boost: (filePath: string) => number) => Promise<{ sourceDoc: string }[]>;
