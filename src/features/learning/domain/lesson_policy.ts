import { Lesson, LessonStats, LessonStatus, ObservedFailure } from './learning_types.js';

/** Runs a failure may stay red after a lesson was offered before that lesson counts as not helping. */
export const RUNS_BEFORE_NOT_HELPED = 5;
const REVIEW_MIN_NEGATIVES = 3;
const REVIEW_THRESHOLD = 0.35;
const RECOVER_THRESHOLD = 0.5;
const EXPORT_MIN_HELPED = 3;
const EXPORT_THRESHOLD = 0.7;

/** Laplace-smoothed success rate: 0.5 with no evidence, moves toward the observed rate as evidence grows. */
export function effectiveness(stats: LessonStats): number {
  return Number(((stats.helped + 1) / (stats.helped + stats.notHelped + 2)).toFixed(3));
}

/** Status follows evidence; a retired lesson stays retired until a human or the model rewrites it. */
export function nextStatus(lesson: Lesson): LessonStatus {
  if (lesson.status === 'retired') return 'retired';
  const score = effectiveness(lesson.stats);
  if (lesson.stats.notHelped >= REVIEW_MIN_NEGATIVES && score < REVIEW_THRESHOLD) return 'needs_review';
  if (lesson.status === 'needs_review' && score < RECOVER_THRESHOLD) return 'needs_review';
  return 'active';
}

/** Proven lessons are promoted to Claude Code skills. */
export function isExportable(lesson: Lesson): boolean {
  return lesson.status === 'active' && lesson.stats.helped >= EXPORT_MIN_HELPED && effectiveness(lesson.stats) >= EXPORT_THRESHOLD;
}

/** Multiplier applied to a lesson's search score: proven lessons rise, weak ones sink, retired vanish. */
export function rankingBoost(lesson: Lesson): number {
  if (lesson.status === 'retired') return 0;
  if (lesson.status === 'needs_review') return 0.6;
  return 0.75 + 0.5 * effectiveness(lesson.stats);
}

/**
 * Stable fingerprint of a failure so the same problem is recognized across runs and projects:
 * paths, numbers, quoted values and hex ids are masked.
 */
export function failureSignature(check: string, failures: ObservedFailure[]): string {
  const first = failures[0];
  if (!first) return `${check}:unknown`;
  const message = first.errorMessage
    .split(/\r?\n/)
    .find((line) => line.trim())
    ?.toLowerCase()
    .replace(/([a-z]:)?[\\/][\w.\-\\/]+/g, '<path>')
    .replace(/(["'`]).*?\1/g, '<value>')
    .replace(/0x[0-9a-f]+/g, '<hex>')
    .replace(/\d+(\.\d+)?/g, 'n')
    .replace(/\s+/g, ' ')
    .trim();
  return `${check}:${(message || 'unknown').slice(0, 160)}`;
}

/** Short human summary of a failure set, for briefings and prompts. */
export function describeFailures(failures: ObservedFailure[]): string {
  const first = failures[0];
  if (!first) return 'no details';
  const where = first.file ? ` (${first.file}${first.line ? `:${first.line}` : ''})` : '';
  const message = first.errorMessage.split(/\r?\n/)[0].slice(0, 140);
  const more = failures.length > 1 ? ` +${failures.length - 1} more` : '';
  return `${first.testName ? `${first.testName}: ` : ''}${message}${where}${more}`;
}

export function slugify(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'lesson'
  );
}
