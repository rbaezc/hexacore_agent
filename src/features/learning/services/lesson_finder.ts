import * as path from 'node:path';
import { IFileSystem } from '../../../shared/infrastructure/file_system.js';
import { WorkspaceContext } from '../../../shared/infrastructure/workspace.js';
import { analyze } from '../../../shared/domain/text_analyzer.js';
import { Lesson, LessonScope, LessonSearch, LessonSuggestion } from '../domain/learning_types.js';
import { effectiveness, rankingBoost } from '../domain/lesson_policy.js';
import { lessonBody } from './lesson_documents.js';

/** Retrieval over learned lessons only, ranked by relevance × proven effectiveness. */
export class LessonFinder {
  constructor(
    private readonly fileSystem: IFileSystem,
    private readonly workspace: WorkspaceContext,
    private readonly search: LessonSearch
  ) {}

  skillsDir(): string {
    return this.workspace.hexagenPath('skills');
  }

  /** Search score multiplier per lesson file, for this finder and the main knowledge search. */
  boostFor(lessons: Lesson[]): (filePath: string) => number {
    const byPath = new Map(lessons.map((l) => [path.resolve(this.workspace.root, l.file), rankingBoost(l)]));
    // Documents that aren't indexed lessons (rules, ADRs, hand-written lessons) rank neutrally.
    return (filePath) => byPath.get(path.resolve(filePath)) ?? 1;
  }

  async find(query: string, lessons: Lesson[], stack: LessonScope | undefined, limit: number): Promise<LessonSuggestion[]> {
    const candidates = lessons.filter((l) => l.status !== 'retired' && (!stack || l.stack === 'any' || l.stack === stack));
    if (candidates.length === 0 || !query.trim()) return [];

    const ranked = await this.search(query, this.skillsDir(), this.boostFor(lessons));
    const byPath = new Map(candidates.map((l) => [path.resolve(this.workspace.root, l.file), l]));
    const seen = new Set<string>();
    const suggestions: LessonSuggestion[] = [];
    for (const snippet of ranked) {
      const lesson = byPath.get(path.resolve(snippet.sourceDoc));
      if (!lesson || seen.has(lesson.id)) continue;
      seen.add(lesson.id);
      const markdown = await this.fileSystem.readFile(snippet.sourceDoc).catch(() => '');
      suggestions.push({
        id: lesson.id,
        title: lesson.title,
        stack: lesson.stack,
        file: lesson.file,
        effectiveness: effectiveness(lesson.stats),
        status: lesson.status,
        content: lessonBody(markdown).slice(0, 2000),
      });
      if (suggestions.length >= limit) break;
    }
    return suggestions;
  }

  /** Lessons that say nearly the same thing (token overlap of title + problem): merge candidates. */
  similar(target: { title: string; problem: string; stack: LessonScope }, lessons: Lesson[], excludeId?: string): { id: string; title: string; similarity: number }[] {
    const tokens = new Set(analyze(`${target.title} ${target.problem}`));
    return lessons
      .filter((l) => l.id !== excludeId && l.status !== 'retired' && (l.stack === target.stack || l.stack === 'any' || target.stack === 'any'))
      .map((l) => ({ id: l.id, title: l.title, similarity: jaccard(tokens, new Set(analyze(`${l.title} ${l.problem}`))) }))
      .filter((s) => s.similarity >= 0.5)
      .sort((a, b) => b.similarity - a.similarity);
  }
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return Number((shared / (a.size + b.size - shared)).toFixed(3));
}
