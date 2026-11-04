import { Result, ok, fail } from '../../../shared/domain/result.js';
import { SupportedStack } from '../../../shared/domain/stack.js';
import { Episode, FixAttribution, LearningSummary, Lesson, LessonScope, LessonStats, LessonSuggestion, ObservedCheck, OpenFailure } from '../domain/learning_types.js';
import { REVIEW_STALE_DAYS, RUNS_BEFORE_NOT_HELPED, describeFailures, effectiveness, failureSignature, idleDays, isExportable, nextStatus } from '../domain/lesson_policy.js';
import { LearningRepository } from './learning_repository.js';
import { LessonFinder, parseLessonId } from './lesson_finder.js';
import { LessonLibrary, shareableLessons } from './lesson_library.js';
import { FixAttributor } from './fix_attributor.js';

const SUGGESTIONS_PER_FAILURE = 3;

export interface ObservedEpisode {
  id: string;
  stack: SupportedStack;
  check: string;
  summary: string;
  /** Earlier episodes with the same failure signature: a recurring problem worth a lesson. */
  recurrences: number;
  creditedLessonIds: string[];
  /** Offered lessons the fix doesn't resemble: not credited, not penalized. */
  unconfirmedLessonIds: string[];
  attribution: FixAttribution;
  changedFiles: string[];
}

export interface ObservationReport {
  /** Checks that went from red to green in this run: experience to distill with record_lesson. */
  resolved: ObservedEpisode[];
  /** Learned lessons relevant to the checks that are red now (project lessons first, then the library). */
  suggestions: LessonSuggestion[];
}

export interface LearningServiceDeps {
  repo: LearningRepository;
  finder: LessonFinder;
  /** Without it, every offered lesson is credited when its failure resolves (correlational). */
  attributor?: FixAttributor;
  library?: LessonLibrary;
  /** Name recorded in the library for lessons this project shares or is helped by. */
  projectName: () => string;
}

/**
 * The learning loop's sensor and scorekeeper: watches QA outcomes, turns red→green transitions
 * into episodes, offers relevant lessons while something is red, and credits the lessons that the
 * fix actually resembles (or debits them when the failure stays red).
 */
export class LearningService {
  constructor(private readonly deps: LearningServiceDeps) {}

  get library(): LessonLibrary | undefined {
    return this.deps.library;
  }

  /** Search multiplier for the main knowledge search, so proven lessons rank above weak ones. */
  async documentBoost(): Promise<(filePath: string) => number> {
    const store = await this.deps.repo.load();
    const libraryBoost = this.deps.library ? this.deps.library.finder.boostFor(await this.deps.library.lessons()) : () => 1;
    return this.deps.finder.boostFor(store.isSuccess ? store.value.lessons : [], libraryBoost);
  }

  async observe(checks: ObservedCheck[], cwd: string): Promise<Result<ObservationReport, Error>> {
    const loaded = await this.deps.repo.load();
    if (loaded.isFailure) return fail(loaded.error);
    const { lessons, openFailures } = loaded.value;

    // Retrieval, snapshots and attribution happen outside the store lock; only bookkeeping is serialized.
    const offers = new Map<string, LessonSuggestion[]>();
    for (const c of checks.filter((c) => c.status === 'failed')) {
      const query = `${c.stack} ${c.check} ${c.failures.slice(0, 3).map((f) => `${f.testName ?? ''} ${f.errorMessage}`).join(' ')}`;
      offers.set(keyOf(c, cwd), await this.suggestFor(query, c.stack, SUGGESTIONS_PER_FAILURE, lessons));
    }
    const { fixes, verdicts } = (await this.deps.attributor?.judge(checks, cwd, openFailures, lessons, keyOf)) ?? { fixes: new Map(), verdicts: new Map() };

    const library: { id: string; change: (stats: LessonStats) => void }[] = [];
    const update = await this.deps.repo.update((store) => {
      const now = new Date().toISOString();
      const report: ObservationReport = { resolved: [], suggestions: [] };
      const apply = (id: string, change: (stats: LessonStats) => void) => {
        const ref = parseLessonId(id);
        if (ref.origin === 'library') library.push({ id: ref.id, change });
        else adjust(store.lessons, id, (l) => change(l.stats));
      };

      for (const c of checks) {
        if (c.status === 'skipped') continue;
        const key = keyOf(c, cwd);
        const open = store.openFailures.find((o) => o.key === key);

        if (c.status === 'failed') {
          const offered = offers.get(key) ?? [];
          const current: OpenFailure = open ?? { key, stack: c.stack, check: c.check, cwd, signature: '', failures: [], since: now, runs: 0, offeredLessonIds: [] };
          current.runs++;
          current.failures = c.failures.slice(0, 5);
          current.signature = failureSignature(c.check, c.failures);
          if (current.runs >= RUNS_BEFORE_NOT_HELPED && current.offeredLessonIds.length) {
            // Offered for several runs and still red: count it against those lessons, once.
            for (const id of current.offeredLessonIds) apply(id, (s) => s.notHelped++);
            current.offeredLessonIds = [];
          }
          for (const s of offered) {
            apply(s.id, (stats) => {
              stats.retrieved++;
              stats.lastUsedAt = now;
            });
            if (!current.offeredLessonIds.includes(s.id)) current.offeredLessonIds.push(s.id);
          }
          if (!open) store.openFailures.push(current);
          report.suggestions.push(...offered.filter((s) => !report.suggestions.some((r) => r.id === s.id)));
        } else if (open) {
          const fix = fixes.get(key);
          const verdict = verdicts.get(key) ?? { attribution: 'correlational' as const, credited: open.offeredLessonIds };
          const episode: Episode = {
            id: `ep_${Date.now()}_${store.episodes.length + 1}`,
            stack: open.stack,
            check: open.check,
            cwd,
            signature: open.signature,
            failures: open.failures,
            failedSince: open.since,
            resolvedAt: now,
            runsToResolve: open.runs,
            offeredLessonIds: open.offeredLessonIds,
            changedFiles: fix?.changedFiles.slice(0, 50),
            attribution: verdict.attribution,
            creditedLessonIds: verdict.credited,
          };
          for (const id of verdict.credited) apply(id, (s) => s.helped++);
          const recurrences = store.episodes.filter((e) => e.signature === episode.signature).length;
          store.episodes.push(episode);
          store.openFailures = store.openFailures.filter((o) => o.key !== key);
          report.resolved.push({
            id: episode.id,
            stack: episode.stack,
            check: episode.check,
            summary: describeFailures(episode.failures),
            recurrences,
            creditedLessonIds: verdict.credited,
            unconfirmedLessonIds: open.offeredLessonIds.filter((id) => !verdict.credited.includes(id)),
            attribution: verdict.attribution,
            changedFiles: episode.changedFiles ?? [],
          });
        }
      }
      return report;
    });
    if (update.isSuccess) await this.deps.library?.record(library, this.deps.projectName());
    return update;
  }

  /** Explicit feedback from the model or the user; also the way to retire a lesson. */
  async rate(lessonId: string, input: { helpful?: boolean; retire?: boolean }): Promise<Result<Lesson & { effectiveness: number }, Error>> {
    const ref = parseLessonId(lessonId);
    if (ref.origin === 'library') {
      if (!this.deps.library) return fail(new Error('The lesson library is disabled.'));
      return this.deps.library.rate(ref.id, input);
    }
    const updated = await this.deps.repo.update((store) => {
      const lesson = store.lessons.find((l) => l.id === lessonId);
      if (!lesson) return undefined;
      if (input.helpful === true) lesson.stats.helped++;
      if (input.helpful === false) lesson.stats.notHelped++;
      lesson.status = input.retire ? 'retired' : nextStatus(lesson);
      lesson.updatedAt = new Date().toISOString();
      return { ...lesson, effectiveness: effectiveness(lesson.stats) };
    });
    if (updated.isFailure) return fail(updated.error);
    return updated.value ? ok(updated.value) : fail(new Error(`Lesson '${lessonId}' not found. See review_lessons for ids.`));
  }

  async suggest(query: string, stack: LessonScope | undefined, limit: number): Promise<Result<LessonSuggestion[], Error>> {
    const loaded = await this.deps.repo.load();
    if (loaded.isFailure) return fail(loaded.error);
    return ok(await this.suggestFor(query, stack, limit, loaded.value.lessons));
  }

  /** Project lessons take precedence; the library fills the remaining slots. */
  private async suggestFor(query: string, stack: LessonScope | undefined, limit: number, lessons: Lesson[]): Promise<LessonSuggestion[]> {
    const own = await this.deps.finder.find(query, lessons, stack, limit);
    const shared = this.deps.library ? await this.deps.library.find(query, stack, limit - own.length, lessons) : [];
    return [...own, ...shared];
  }

  async summary(stacks: readonly SupportedStack[] = []): Promise<Result<LearningSummary, Error>> {
    const loaded = await this.deps.repo.load();
    if (loaded.isFailure) return fail(loaded.error);
    const { lessons, episodes } = loaded.value;
    const live = lessons.filter((l) => l.status !== 'retired');
    const score = (l: Lesson) => ({ id: l.id, title: l.title, effectiveness: effectiveness(l.stats) });

    const unlearned = new Map<string, LearningSummary['unlearnedEpisodes'][number]>();
    // An episode resolved while lessons were offered is already covered by knowledge.
    for (const e of episodes.filter((e) => !e.lessonId && e.offeredLessonIds.length === 0)) {
      const prev = unlearned.get(e.signature);
      unlearned.set(e.signature, { id: e.id, stack: e.stack, check: e.check, summary: describeFailures(e.failures), recurrences: (prev?.recurrences ?? 0) + 1 });
    }

    return ok({
      lessons: lessons.length,
      active: live.filter((l) => l.status === 'active').length,
      needsReview: live.filter((l) => l.status === 'needs_review').map(score),
      unlearnedEpisodes: [...unlearned.values()].sort((a, b) => b.recurrences - a.recurrences).slice(0, 10),
      exportable: live.filter((l) => isExportable(l) && !l.exportedTo).map(score),
      topLessons: live
        .filter((l) => stacks.length === 0 || l.stack === 'any' || stacks.includes(l.stack as SupportedStack))
        .sort((a, b) => effectiveness(b.stats) - effectiveness(a.stats) || b.stats.helped - a.stats.helped)
        .slice(0, 5)
        .map((l) => ({ ...score(l), stack: l.stack })),
      duplicates: this.deps.finder.duplicates(live),
      stale: live
        .map((l) => ({ id: l.id, title: l.title, idleDays: Math.floor(idleDays(l)) }))
        .filter((l) => l.idleDays >= REVIEW_STALE_DAYS)
        .sort((a, b) => b.idleDays - a.idleDays)
        .slice(0, 10),
      shareable: this.deps.library ? shareableLessons(lessons).map(score) : [],
      library: this.deps.library ? await this.deps.library.summary(stacks) : undefined,
    });
  }
}

function keyOf(c: { stack: string; check: string }, cwd: string): string {
  return `${c.stack}:${c.check}:${cwd}`;
}

function adjust(lessons: Lesson[], id: string, change: (lesson: Lesson) => void): void {
  const lesson = lessons.find((l) => l.id === id);
  if (!lesson) return;
  change(lesson);
  lesson.status = nextStatus(lesson);
}
