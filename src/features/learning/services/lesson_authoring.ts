import * as path from 'node:path';
import { IFileSystem } from '../../../shared/infrastructure/file_system.js';
import { WorkspaceContext } from '../../../shared/infrastructure/workspace.js';
import { ChangeJournal } from '../../../shared/infrastructure/change_journal.js';
import { Result, ok, fail } from '../../../shared/domain/result.js';
import { Lesson, LessonInput, MergeInput } from '../domain/learning_types.js';
import { isExportable, nextStatus, slugify, uniqueSlug } from '../domain/lesson_policy.js';
import { lessonSection, renderLesson, renderSkill } from './lesson_documents.js';
import { LearningRepository } from './learning_repository.js';
import { LessonFinder } from './lesson_finder.js';
import { LessonLibrary, SharedLesson, shareableLessons } from './lesson_library.js';

export interface RecordedLesson {
  lesson: Lesson;
  checkpointId: string;
  /** Lessons saying nearly the same thing: consider merging with updateId instead of keeping both. */
  similar: { id: string; title: string; similarity: number }[];
}

export interface MergedLessons {
  lesson: Lesson;
  /** Lessons folded into it (now retired, kept on disk for history). */
  retired: string[];
  /** Set when the surviving lesson was rewritten. */
  checkpointId?: string;
  /** Claude Code skills exported from the retired lessons: delete them or re-export the survivor. */
  exportedSkills: string[];
}

export interface ExportedSkill {
  lessonId: string;
  name: string;
  file: string;
}

/** Writes lessons (and Claude Code skills) to disk through checkpoints, so learning is reversible. */
export class LessonAuthoring {
  constructor(
    private readonly fileSystem: IFileSystem,
    private readonly workspace: WorkspaceContext,
    private readonly journal: ChangeJournal,
    private readonly repo: LearningRepository,
    private readonly finder: LessonFinder,
    private readonly library?: LessonLibrary,
    private readonly projectName: () => string = () => 'project'
  ) {}

  async record(input: LessonInput): Promise<Result<RecordedLesson, Error>> {
    if (!input.title.trim() || !input.problem.trim() || !input.solution.trim()) {
      return fail(new Error('A lesson needs a title, the problem it applies to and the solution.'));
    }
    const loaded = await this.repo.load();
    if (loaded.isFailure) return fail(loaded.error);
    const store = loaded.value;

    const existing = input.updateId ? store.lessons.find((l) => l.id === input.updateId) : undefined;
    if (input.updateId && !existing) return fail(new Error(`Lesson '${input.updateId}' not found.`));
    const episode = input.episodeId ? store.episodes.find((e) => e.id === input.episodeId) : undefined;
    if (input.episodeId && !episode) return fail(new Error(`Episode '${input.episodeId}' not found.`));

    const stack = input.stack ?? existing?.stack ?? episode?.stack ?? 'any';
    const slug = existing?.slug ?? uniqueSlug(slugify(input.title), store.lessons);
    const version = (existing?.version ?? 0) + 1;
    const learnedFrom = episode ? `${episode.stack} ${episode.check} failure resolved ${episode.resolvedAt.slice(0, 10)} (${episode.id})` : undefined;
    const filePath = path.join(this.finder.skillsDir(), `${slug}.md`);

    const checkpoint = await this.journal.begin(`${existing ? 'Improve' : 'Learn'} lesson: ${input.title.trim()}`);
    const written = await this.journal.write(checkpoint, filePath, renderLesson(input, { stack, version, learnedFrom }));
    if (written.isFailure) return fail(written.error);

    const now = new Date().toISOString();
    const saved = await this.repo.update((s) => {
      const prior = existing && s.lessons.find((l) => l.id === existing.id);
      const lesson: Lesson = {
        id: prior?.id ?? `lesson_${slug}`,
        slug,
        title: input.title.trim(),
        stack,
        tags: input.tags ?? prior?.tags ?? [],
        problem: input.problem.trim().split(/\r?\n/)[0].slice(0, 300),
        file: this.workspace.relative(written.value),
        // Rewriting a lesson is how a weak one gets a second chance.
        status: 'active',
        version,
        episodeIds: [...new Set([...(prior?.episodeIds ?? []), ...(episode ? [episode.id] : [])])],
        stats: prior?.stats ?? { retrieved: 0, helped: 0, notHelped: 0 },
        exportedTo: prior?.exportedTo,
        createdAt: prior?.createdAt ?? now,
        updatedAt: now,
      };
      if (prior) Object.assign(prior, lesson);
      else s.lessons.push(lesson);
      const ep = episode && s.episodes.find((e) => e.id === episode.id);
      if (ep) ep.lessonId = lesson.id;
      return lesson;
    });
    if (saved.isFailure) return fail(saved.error);

    const similar = this.finder.similar({ title: input.title, problem: input.problem, stack }, store.lessons, saved.value.id);
    return ok({ lesson: saved.value, checkpointId: checkpoint.id, similar });
  }

  /**
   * Folds near-duplicate lessons into one: the survivor gets their evidence, episodes and tags, and
   * open failures that were offered them now count for it. Optionally rewrites the survivor's text
   * (fields left out keep its current text). The merged lessons are retired, not deleted.
   */
  async merge(input: MergeInput): Promise<Result<MergedLessons, Error>> {
    const mergeIds = [...new Set(input.mergeIds)].filter((id) => id !== input.keepId);
    if (mergeIds.length === 0) return fail(new Error('mergeIds must name at least one lesson other than keepId.'));
    const loaded = await this.repo.load();
    if (loaded.isFailure) return fail(loaded.error);
    const keep = loaded.value.lessons.find((l) => l.id === input.keepId);
    if (!keep) return fail(new Error(`Lesson '${input.keepId}' not found.`));
    const missing = mergeIds.filter((id) => !loaded.value.lessons.some((l) => l.id === id));
    if (missing.length) return fail(new Error(`Lesson(s) not found: ${missing.join(', ')}.`));

    let checkpointId: string | undefined;
    if (input.title || input.problem || input.solution || input.example || input.tags) {
      const markdown = await this.fileSystem.readFile(this.finder.pathOf(keep)).catch(() => '');
      const rewritten = await this.record({
        updateId: keep.id,
        title: input.title ?? keep.title,
        problem: input.problem ?? (lessonSection(markdown, 'When it applies') || keep.problem),
        solution: input.solution ?? lessonSection(markdown, 'What to do'),
        example: input.example ?? (lessonSection(markdown, 'Example') || undefined),
        tags: input.tags,
      });
      if (rewritten.isFailure) return fail(rewritten.error);
      checkpointId = rewritten.value.checkpointId;
    }

    const saved = await this.repo.update((store) => {
      const survivor = store.lessons.find((l) => l.id === keep.id)!;
      const folded = store.lessons.filter((l) => mergeIds.includes(l.id));
      const now = new Date().toISOString();
      for (const l of folded) {
        survivor.stats.retrieved += l.stats.retrieved;
        survivor.stats.helped += l.stats.helped;
        survivor.stats.notHelped += l.stats.notHelped;
        if ((l.stats.lastUsedAt ?? '') > (survivor.stats.lastUsedAt ?? '')) survivor.stats.lastUsedAt = l.stats.lastUsedAt;
        survivor.episodeIds = [...new Set([...survivor.episodeIds, ...l.episodeIds])];
        survivor.tags = [...new Set([...survivor.tags, ...l.tags])];
        l.status = 'retired';
        l.mergedInto = survivor.id;
        l.updatedAt = now;
      }
      for (const e of store.episodes) if (e.lessonId && mergeIds.includes(e.lessonId)) e.lessonId = survivor.id;
      for (const o of store.openFailures) {
        o.offeredLessonIds = [...new Set(o.offeredLessonIds.map((id) => (mergeIds.includes(id) ? survivor.id : id)))];
      }
      survivor.status = survivor.status === 'retired' ? 'retired' : nextStatus({ ...survivor, status: 'active' });
      survivor.updatedAt = now;
      return { lesson: { ...survivor }, exportedSkills: folded.flatMap((l) => (l.exportedTo ? [l.exportedTo] : [])) };
    });
    if (saved.isFailure) return fail(saved.error);
    return ok({ lesson: saved.value.lesson, retired: mergeIds, checkpointId, exportedSkills: saved.value.exportedSkills });
  }

  /**
   * Promotes lessons to Claude Code skills (`.claude/skills/<name>/SKILL.md`) so the client loads
   * them natively. Without ids, exports every proven lesson not exported yet.
   */
  async exportSkills(lessonIds?: string[]): Promise<Result<{ exported: ExportedSkill[]; checkpointId?: string; skipped: string[] }, Error>> {
    const loaded = await this.repo.load();
    if (loaded.isFailure) return fail(loaded.error);
    const lessons = loaded.value.lessons;

    const skipped: string[] = [];
    const chosen = lessonIds?.length
      ? lessonIds.flatMap((id) => {
          const lesson = lessons.find((l) => l.id === id);
          if (!lesson || lesson.status === 'retired') skipped.push(`${id}: ${lesson ? 'retired' : 'not found'}`);
          return lesson && lesson.status !== 'retired' ? [lesson] : [];
        })
      : lessons.filter((l) => isExportable(l) && !l.exportedTo);
    if (chosen.length === 0) return ok({ exported: [], skipped });

    const checkpoint = await this.journal.begin(`Export ${chosen.length} lesson(s) as Claude Code skills`);
    const exported: ExportedSkill[] = [];
    for (const lesson of chosen) {
      const markdown = await this.fileSystem.readFile(this.finder.pathOf(lesson)).catch(() => undefined);
      if (markdown === undefined) {
        skipped.push(`${lesson.id}: ${lesson.file} is missing`);
        continue;
      }
      const skill = renderSkill(lesson, markdown);
      const written = await this.journal.write(checkpoint, path.join(this.workspace.root, '.claude', 'skills', skill.name, 'SKILL.md'), skill.content);
      if (written.isFailure) return fail(written.error);
      exported.push({ lessonId: lesson.id, name: skill.name, file: this.workspace.relative(written.value) });
    }

    const saved = await this.repo.update((s) => {
      for (const e of exported) {
        const lesson = s.lessons.find((l) => l.id === e.lessonId);
        if (lesson) lesson.exportedTo = e.file;
      }
    });
    if (saved.isFailure) return fail(saved.error);
    return ok({ exported, checkpointId: checkpoint.id, skipped });
  }

  /**
   * Shares project lessons with the user's library so their other projects benefit. Without ids,
   * shares every proven lesson that is new to the library or was rewritten since it was shared.
   */
  async shareLessons(lessonIds?: string[]): Promise<Result<{ shared: SharedLesson[]; skipped: string[]; library: string }, Error>> {
    if (!this.library) return fail(new Error('The lesson library is disabled (HEXACORE_LIBRARY=off).'));
    const loaded = await this.repo.load();
    if (loaded.isFailure) return fail(loaded.error);
    const lessons = loaded.value.lessons;

    const skipped: string[] = [];
    const chosen = lessonIds?.length
      ? lessonIds.flatMap((id) => {
          const lesson = lessons.find((l) => l.id === id);
          if (!lesson || lesson.status === 'retired') skipped.push(`${id}: ${lesson ? 'retired' : 'not found'}`);
          return lesson && lesson.status !== 'retired' ? [lesson] : [];
        })
      : shareableLessons(lessons);

    const documents: { lesson: Lesson; markdown: string }[] = [];
    for (const lesson of chosen) {
      const markdown = await this.fileSystem.readFile(this.finder.pathOf(lesson)).catch(() => undefined);
      if (markdown === undefined) skipped.push(`${lesson.id}: ${lesson.file} is missing`);
      else documents.push({ lesson, markdown });
    }
    if (documents.length === 0) return ok({ shared: [], skipped, library: this.library.root });

    const shared = await this.library.share(documents, this.projectName());
    if (shared.isFailure) return fail(shared.error);
    const saved = await this.repo.update((s) => {
      for (const e of shared.value) {
        const lesson = s.lessons.find((l) => l.id === e.lessonId);
        if (!lesson) continue;
        lesson.sharedAs = e.libraryId;
        lesson.sharedVersion = lesson.version;
      }
    });
    if (saved.isFailure) return fail(saved.error);
    return ok({ shared: shared.value, skipped, library: this.library.root });
  }
}
