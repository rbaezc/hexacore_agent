import * as path from 'node:path';
import { analyze } from '../../../shared/domain/text_analyzer.js';
import { FixDiff } from './learning_types.js';

/** A lesson matches a fix when the fix uses at least this many of its terms… */
const MIN_SHARED_TERMS = 2;
/** …and at least this share of them. */
const MIN_COVERAGE = 0.15;

export interface LessonMatch {
  matched: boolean;
  shared: string[];
  coverage: number;
}

/**
 * Does the fix look like what the lesson says to do? Compares the lesson's terms with the lines
 * the fix added or removed and the names of the files it touched. Cheap and explainable on purpose:
 * it filters out lessons that were offered but plainly unrelated to the change that turned the check green.
 */
export function matchLessonToFix(lessonText: string, fix: FixDiff): LessonMatch {
  const lessonTerms = terms(lessonText);
  if (lessonTerms.size === 0) return { matched: false, shared: [], coverage: 0 };
  const fixTerms = terms(`${fix.changedText}\n${fix.changedFiles.map((f) => path.basename(f).replace(/[._-]/g, ' ')).join(' ')}`);
  const shared = [...lessonTerms].filter((t) => fixTerms.has(t));
  const coverage = Number((shared.length / lessonTerms.size).toFixed(3));
  return { matched: shared.length >= MIN_SHARED_TERMS && coverage >= MIN_COVERAGE, shared, coverage };
}

/** Distinctive terms only: very short tokens and bare numbers say nothing about a fix. */
function terms(text: string): Set<string> {
  return new Set(analyze(text).filter((t) => t.length >= 3 && !/^\d+$/.test(t)));
}

/** Line-level diff of two versions of a file, as the added and removed lines. */
export function changedLines(before: string | undefined, after: string | undefined): string[] {
  const a = (before ?? '').split(/\r?\n/);
  const b = (after ?? '').split(/\r?\n/);
  const inA = new Set(a);
  const inB = new Set(b);
  return [...b.filter((l) => !inA.has(l)), ...a.filter((l) => !inB.has(l))].filter((l) => l.trim());
}
