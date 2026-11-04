import { Lesson, LessonStats, LessonStatus, ObservedFailure } from './learning_types.js';

/** Runs a failure may stay red after a lesson was offered before that lesson counts as not helping. */
export const RUNS_BEFORE_NOT_HELPED = 5;
const REVIEW_MIN_NEGATIVES = 3;
const REVIEW_THRESHOLD = 0.35;
const RECOVER_THRESHOLD = 0.5;
const EXPORT_MIN_HELPED = 3;
const EXPORT_THRESHOLD = 0.7;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Lessons used or rewritten within this many days rank at full weight… */
const FRESH_DAYS = 60;
/** …and lose weight linearly until this age, where they stay at STALE_WEIGHT. */
const STALE_DAYS = 365;
const STALE_WEIGHT = 0.6;
/** Unused for this long: reported as stale in review_lessons. */
export const REVIEW_STALE_DAYS = 180;

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

/** Multiplier applied to a lesson's search score: proven lessons rise, weak and long-unused ones sink, retired vanish. */
export function rankingBoost(lesson: Lesson, now: number = Date.now()): number {
  if (lesson.status === 'retired') return 0;
  const base = lesson.status === 'needs_review' ? 0.6 : 0.75 + 0.5 * effectiveness(lesson.stats);
  return Number((base * freshness(lesson, now)).toFixed(3));
}

/** Days since the lesson was last offered or rewritten. */
export function idleDays(lesson: Lesson, now: number = Date.now()): number {
  const last = Math.max(Date.parse(lesson.stats.lastUsedAt ?? '') || 0, Date.parse(lesson.updatedAt) || 0);
  return last ? Math.max(0, (now - last) / DAY_MS) : 0;
}

/** 1 while a lesson is in use; decays toward STALE_WEIGHT as it goes unused (code and tools move on). */
export function freshness(lesson: Lesson, now: number = Date.now()): number {
  const days = idleDays(lesson, now);
  if (days <= FRESH_DAYS) return 1;
  if (days >= STALE_DAYS) return STALE_WEIGHT;
  return 1 - ((1 - STALE_WEIGHT) * (days - FRESH_DAYS)) / (STALE_DAYS - FRESH_DAYS);
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

export function uniqueSlug(base: string, lessons: { slug: string }[]): string {
  let slug = base;
  for (let i = 2; lessons.some((l) => l.slug === slug); i++) slug = `${base}-${i}`;
  return slug;
}
