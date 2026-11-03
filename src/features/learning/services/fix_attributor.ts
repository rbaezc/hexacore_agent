import { FixAttribution, FixDiff, Lesson, ObservedCheck, OpenFailure } from '../domain/learning_types.js';
import { matchLessonToFix } from '../domain/fix_attribution.js';
import { LessonFinder, parseLessonId } from './lesson_finder.js';
import { LessonLibrary } from './lesson_library.js';
import { Snapshot, WorkspaceSnapshots } from './workspace_snapshots.js';

export interface FixVerdict {
  attribution: FixAttribution;
  credited: string[];
}

/**
 * Credit assignment by evidence: snapshots the project the first time a failure is seen red (in
 * this process) and, when it goes green, credits only the offered lessons the fix resembles.
 */
export class FixAttributor {
  /** Keyed like OpenFailure.key. */
  private readonly redSnapshots = new Map<string, Snapshot>();

  constructor(
    private readonly snapshots: WorkspaceSnapshots,
    private readonly finder: LessonFinder,
    private readonly library?: LessonLibrary
  ) {}

  async judge(
    checks: ObservedCheck[],
    cwd: string,
    openFailures: OpenFailure[],
    lessons: Lesson[],
    keyOf: (c: ObservedCheck, cwd: string) => string
  ): Promise<{ fixes: Map<string, FixDiff>; verdicts: Map<string, FixVerdict> }> {
    const fixes = new Map<string, FixDiff>();
    const verdicts = new Map<string, FixVerdict>();
    let now: Snapshot | undefined;
    const current = async () => (now ??= await this.snapshots.take(cwd));

    for (const c of checks) {
      const key = keyOf(c, cwd);
      if (c.status === 'failed' && !this.redSnapshots.has(key)) this.redSnapshots.set(key, await current());
      if (c.status !== 'passed') continue;
      const before = this.redSnapshots.get(key);
      this.redSnapshots.delete(key);
      const open = openFailures.find((o) => o.key === key);
      // No snapshot of the red state (e.g. the server restarted): the caller falls back to correlation.
      if (!before || !open) continue;
      const fix = WorkspaceSnapshots.diff(before, await current());
      fixes.set(key, fix);
      verdicts.set(key, await this.attribute(open.offeredLessonIds, fix, lessons));
    }
    return { fixes, verdicts };
  }

  private async attribute(offeredIds: string[], fix: FixDiff, lessons: Lesson[]): Promise<FixVerdict> {
    if (fix.changedFiles.length === 0) return { attribution: 'no_change', credited: [] };
    const libraryLessons = offeredIds.some((id) => parseLessonId(id).origin === 'library') ? ((await this.library?.lessons()) ?? []) : [];
    const credited: string[] = [];
    for (const id of offeredIds) {
      const ref = parseLessonId(id);
      const lesson = (ref.origin === 'library' ? libraryLessons : lessons).find((l) => l.id === ref.id);
      const finder = ref.origin === 'library' ? this.library?.finder : this.finder;
      if (!lesson || !finder) continue;
      if (matchLessonToFix(await finder.content(lesson), fix).matched) credited.push(id);
    }
    return { attribution: 'diff', credited };
  }
}
