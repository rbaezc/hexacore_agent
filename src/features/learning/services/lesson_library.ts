import * as path from 'node:path';
import { IFileSystem } from '../../../shared/infrastructure/file_system.js';
import { Result, ok, fail } from '../../../shared/domain/result.js';
import { SupportedStack } from '../../../shared/domain/stack.js';
import { Lesson, LessonScope, LessonSearch, LessonStats, LessonSuggestion } from '../domain/learning_types.js';
import { effectiveness, isExportable, nextStatus, slugify, uniqueSlug } from '../domain/lesson_policy.js';
import { LearningRepository } from './learning_repository.js';
import { LessonFinder, suggestionId } from './lesson_finder.js';

export interface SharedLesson {
  lessonId: string;
  libraryId: string;
  file: string;
  updated: boolean;
}

/**
 * The user's lessons across projects (`~/.hexacore/lessons/`, index in `~/.hexacore/learning.json`).
 * Proven project lessons are shared here explicitly (share_lessons), offered to other projects of
 * the same stack after their own lessons, and scored by the outcomes in every project that uses them.
 */
export class LessonLibrary {
  readonly repo: LearningRepository;
  readonly finder: LessonFinder;

  constructor(
    private readonly fileSystem: IFileSystem,
    readonly root: string,
    search: LessonSearch
  ) {
    this.repo = new LearningRepository(fileSystem, () => path.join(root, 'learning.json'));
    this.finder = new LessonFinder(fileSystem, { root: () => root, skillsDir: () => path.join(root, 'lessons') }, search, 'library');
  }

  async lessons(): Promise<Lesson[]> {
    const loaded = await this.repo.load();
    return loaded.isSuccess ? loaded.value.lessons : [];
  }

  /** Library lessons for a stack, skipping the ones that are copies of `projectLessons`. */
  async find(query: string, stack: LessonScope | undefined, limit: number, projectLessons: Lesson[]): Promise<LessonSuggestion[]> {
    const own = new Set(projectLessons.flatMap((l) => (l.sharedAs ? [l.sharedAs] : [])));
    return this.finder.find(query, await this.lessons(), stack, limit, own);
  }

  /** Applies outcome evidence from a project; `project` is remembered as a user of the lesson. */
  async record(evidence: { id: string; change: (stats: LessonStats) => void }[], project: string): Promise<void> {
    if (evidence.length === 0) return;
    await this.repo.update((store) => {
      for (const e of evidence) {
        const lesson = store.lessons.find((l) => l.id === e.id);
        if (!lesson) continue;
        e.change(lesson.stats);
        lesson.stats.lastUsedAt = new Date().toISOString();
        lesson.projects = [...new Set([...(lesson.projects ?? []), project])];
        lesson.status = nextStatus(lesson);
      }
    });
  }

  async rate(id: string, input: { helpful?: boolean; retire?: boolean }): Promise<Result<Lesson & { effectiveness: number }, Error>> {
    const updated = await this.repo.update((store) => {
      const lesson = store.lessons.find((l) => l.id === id);
      if (!lesson) return undefined;
      if (input.helpful === true) lesson.stats.helped++;
      if (input.helpful === false) lesson.stats.notHelped++;
      lesson.status = input.retire ? 'retired' : nextStatus(lesson);
      lesson.updatedAt = new Date().toISOString();
      return { ...lesson, id: suggestionId('library', lesson.id), effectiveness: effectiveness(lesson.stats) };
    });
    if (updated.isFailure) return fail(updated.error);
    return updated.value ? ok(updated.value) : fail(new Error(`Library lesson '${id}' not found.`));
  }

  /**
   * Copies project lessons into the library. A lesson shared before is updated in place (its library
   * stats keep accumulating); a new one starts with the project's evidence.
   */
  async share(lessons: { lesson: Lesson; markdown: string }[], project: string): Promise<Result<SharedLesson[], Error>> {
    const shared: SharedLesson[] = [];
    const now = new Date().toISOString();
    for (const { lesson, markdown } of lessons) {
      const result = await this.repo.update((store) => {
        const existing = lesson.sharedAs ? store.lessons.find((l) => l.id === lesson.sharedAs) : undefined;
        const slug = existing?.slug ?? uniqueSlug(slugify(lesson.title), store.lessons);
        const entry: Lesson = {
          ...lesson,
          id: existing?.id ?? `lesson_${slug}`,
          slug,
          file: `lessons/${slug}.md`,
          episodeIds: [],
          stats: existing?.stats ?? { ...lesson.stats },
          status: existing ? nextStatus({ ...existing, status: 'active' }) : 'active',
          version: (existing?.version ?? 0) + 1,
          exportedTo: undefined,
          sharedAs: undefined,
          sharedVersion: undefined,
          projects: [...new Set([...(existing?.projects ?? []), project])],
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        if (existing) Object.assign(existing, entry);
        else store.lessons.push(entry);
        return { entry, updated: Boolean(existing) };
      });
      if (result.isFailure) return fail(result.error);
      const { entry, updated } = result.value;
      try {
        await this.fileSystem.writeFileAtomic(path.join(this.root, entry.file), markdown.replace('- **Stack:**', `- **Shared from:** ${project}\n- **Stack:**`));
      } catch (error: any) {
        return fail(new Error(`Failed to write ${entry.file} in the lesson library: ${error.message}`));
      }
      shared.push({ lessonId: lesson.id, libraryId: entry.id, file: path.join(this.root, entry.file), updated });
    }
    return ok(shared);
  }

  async summary(stacks: readonly SupportedStack[]): Promise<{ lessons: number; topLessons: { id: string; title: string; stack: LessonScope; effectiveness: number }[] }> {
    const live = (await this.lessons()).filter((l) => l.status !== 'retired' && (stacks.length === 0 || l.stack === 'any' || stacks.includes(l.stack as SupportedStack)));
    return {
      lessons: live.length,
      topLessons: live
        .sort((a, b) => effectiveness(b.stats) - effectiveness(a.stats) || b.stats.helped - a.stats.helped)
        .slice(0, 3)
        .map((l) => ({ id: suggestionId('library', l.id), title: l.title, stack: l.stack, effectiveness: effectiveness(l.stats) })),
    };
  }
}

/** Project lessons worth sharing: proven, and new to the library or rewritten since they were shared. */
export function shareableLessons(lessons: Lesson[]): Lesson[] {
  return lessons.filter((l) => isExportable(l) && (!l.sharedAs || (l.sharedVersion ?? 0) < l.version));
}
