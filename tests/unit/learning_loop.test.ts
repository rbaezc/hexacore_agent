import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { createTestHexaCore, TEST_ROOT } from '../helpers/test_hexacore.js';
import { InMemoryFileSystem } from '../helpers/in_memory_fs.js';
import { createToolRegistry } from '../../src/features/mcp_server/infrastructure/mcp_server_factory.js';
import { failureSignature, effectiveness, nextStatus, isExportable } from '../../src/features/learning/index.js';

const ctx = { reportProgress: async () => {} };

/** Workspace whose successive test runs report the given failure counts, driven through the MCP tools. */
function setup(testFailures: number[], options: { fs?: InMemoryFileSystem; root?: string } = {}) {
  const t = createTestHexaCore(testFailures, options);
  const registry = createToolRegistry(t.services);
  const call = async (tool: string, input: Record<string, unknown> = {}): Promise<any> => {
    const res = await registry.call(tool, input, ctx);
    if (res.isFailure) throw res.error;
    return res.value;
  };
  const root = options.root ?? TEST_ROOT;
  /** Simulates the model editing the project between QA runs. */
  const edit = (file: string, content: string) => t.fs.writeFile(path.join(root, file), content);
  return { ...t, call, edit, qa: () => call('run_quality_assurance', { stack: 'node' }) };
}

const ENTITY = 'src/features/orders/domain/order.ts';
const goodFix = 'export function createOrder(total: number) {\n  return { id: crypto.randomUUID(), total };\n}\n';
const unrelatedFix = 'export function createOrder(total: number) {\n  return { total: Math.round(total) };\n}\n';

const lessonInput = {
  title: 'Generate ids in the domain entity',
  problem: 'Tests fail with "expected id" because the handler returns an entity without an id.',
  solution: 'Create the id in the entity factory (crypto.randomUUID()), never in the presentation layer.',
};

describe('learning loop', () => {
  it('turns a red→green transition into an episode and asks for a lesson', async () => {
    const { qa } = setup([1, 0]);
    const red = await qa();
    expect(red.passed).toBe(false);
    expect(red.learning.resolved).toEqual([]);

    const green = await qa();
    expect(green.passed).toBe(true);
    expect(green.learning.resolved).toHaveLength(1);
    const episode = green.learning.resolved[0];
    expect(episode.summary).toContain('expected id');
    expect(green.nextActions.join(' ')).toContain(`record_lesson with episodeId '${episode.id}'`);
  });

  it('records a lesson as reviewable markdown, links the episode, and suggests it when the problem recurs', async () => {
    const { qa, call, fs, edit } = setup([1, 0, 1, 0]);
    await qa();
    const episodeId = (await qa()).learning.resolved[0].id;

    const recorded = await call('record_lesson', { ...lessonInput, episodeId });
    expect(recorded.lesson.stack).toBe('node');
    expect(recorded.lesson.file).toBe('.hexagen/skills/generate-ids-in-the-domain-entity.md');
    const markdown = await fs.readFile(path.join(TEST_ROOT, recorded.lesson.file));
    expect(markdown).toContain('## When it applies');
    expect(markdown).toContain(`(${episodeId})`);

    const review = await call('review_lessons');
    expect(review.unlearnedEpisodes).toEqual([]);

    // Same failure again: the lesson is offered, and credited when the fix does what it says.
    const red = await qa();
    expect(red.learning.suggestions.map((s: any) => s.id)).toEqual([recorded.lesson.id]);
    expect(red.learning.suggestions[0].content).toContain('crypto.randomUUID()');
    await edit(ENTITY, goodFix);
    const green = await qa();
    expect(green.learning.resolved[0].attribution).toBe('diff');
    expect(green.learning.resolved[0].changedFiles).toEqual([ENTITY]);
    expect(green.learning.resolved[0].creditedLessonIds).toEqual([recorded.lesson.id]);
    expect(green.learning.resolved[0].recurrences).toBe(1);

    const after = await call('review_lessons', { query: 'expected id' });
    expect(after.matches[0].effectiveness).toBeCloseTo(2 / 3, 2);
    // Resolved with a lesson on hand: not reported as experience still to distill.
    expect(after.unlearnedEpisodes).toEqual([]);
  });

  it('credits only the lessons the fix resembles', async () => {
    const { qa, call, edit } = setup([1, 0, 1, 0]);
    await edit(ENTITY, unrelatedFix.replace('Math.round(total)', 'total'));
    const { lesson } = await call('record_lesson', lessonInput);

    // Unrelated fix: offered but not credited, and the model is told it can rate it explicitly.
    await qa();
    await edit(ENTITY, unrelatedFix);
    const unrelated = await qa();
    expect(unrelated.learning.resolved[0].attribution).toBe('diff');
    expect(unrelated.learning.resolved[0].creditedLessonIds).toEqual([]);
    expect(unrelated.learning.resolved[0].unconfirmedLessonIds).toEqual([lesson.id]);
    expect(unrelated.nextActions.join(' ')).toContain(`doesn't resemble lesson(s) ${lesson.id}`);

    // Green without any change (flaky test): nobody gets credit.
    await qa();
    const flaky = await qa();
    expect(flaky.learning.resolved[0].attribution).toBe('no_change');
    expect(flaky.learning.resolved[0].creditedLessonIds).toEqual([]);

    const [match] = (await call('review_lessons', { query: 'expected id' })).matches;
    expect(match.effectiveness).toBe(0.5);
  });

  it('falls back to correlational credit when the red state was not captured', async () => {
    const first = setup([1]);
    const { lesson } = await first.call('record_lesson', lessonInput);
    await first.qa();
    // A new process on the same project: the red snapshot is gone.
    const second = setup([0], { fs: first.fs });
    const green = await second.qa();
    expect(green.learning.resolved[0].attribution).toBe('correlational');
    expect(green.learning.resolved[0].creditedLessonIds).toEqual([lesson.id]);
  });

  it('debits a lesson that was offered while the failure stayed red for several runs', async () => {
    const { qa, call } = setup([1, 0, 1]);
    await qa();
    const episodeId = (await qa()).learning.resolved[0].id;
    const { lesson } = await call('record_lesson', { ...lessonInput, episodeId });
    for (let i = 0; i < 5; i++) await qa();
    const [match] = (await call('review_lessons', { query: 'expected id' })).matches;
    expect(match.id).toBe(lesson.id);
    expect(match.effectiveness).toBeCloseTo(1 / 3, 2);
  });

  it('flags lessons with negative evidence for review and stops offering retired ones', async () => {
    const { call, qa } = setup([1]);
    const { lesson } = await call('record_lesson', lessonInput);
    for (let i = 0; i < 3; i++) await call('rate_lesson', { lessonId: lesson.id, helpful: false });
    const review = await call('review_lessons');
    expect(review.needsReview.map((l: any) => l.id)).toEqual([lesson.id]);

    // Rewriting gives it a second chance and keeps its history.
    const rewritten = await call('record_lesson', { ...lessonInput, solution: 'Use the entity factory.', updateId: lesson.id });
    expect(rewritten.lesson.version).toBe(2);
    expect(rewritten.lesson.status).toBe('active');
    expect(rewritten.lesson.stats.notHelped).toBe(3);

    await call('rate_lesson', { lessonId: lesson.id, retire: true });
    expect((await qa()).learning.suggestions).toEqual([]);
    const search = await call('search_knowledge_base', { query: 'expected id entity factory', topK: 10 });
    expect(search.snippets.some((s: any) => s.source === 'lesson')).toBe(false);
  });

  it('ranks lessons in the general knowledge search and warns about near-duplicates', async () => {
    const { call } = setup([0]);
    await call('record_lesson', lessonInput);
    const search = await call('search_knowledge_base', { query: 'expected id entity', topK: 3 });
    expect(search.snippets[0].source).toBe('lesson');

    const duplicate = await call('record_lesson', { ...lessonInput, title: 'Generate the id inside the domain entity' });
    expect(duplicate.lesson.slug).not.toBe('generate-ids-in-the-domain-entity');
    expect(duplicate.similar[0].title).toBe(lessonInput.title);
  });

  it('exports proven lessons as Claude Code skills, reversibly, and mentions learning in the briefing', async () => {
    const { call, fs } = setup([0]);
    const { lesson } = await call('record_lesson', { ...lessonInput, stack: 'node' });
    expect((await call('export_skills')).exported).toEqual([]);

    for (let i = 0; i < 3; i++) await call('rate_lesson', { lessonId: lesson.id, helpful: true });
    const briefing = await call('resume_session');
    expect(briefing.briefing).toContain('Learned lessons (1 active)');
    expect(briefing.learning.exportable.map((l: any) => l.id)).toEqual([lesson.id]);

    const exported = await call('export_skills');
    expect(exported.exported).toHaveLength(1);
    const skillPath = path.join(TEST_ROOT, '.claude/skills/hexacore-generate-ids-in-the-domain-entity/SKILL.md');
    const skill = await fs.readFile(skillPath);
    expect(skill).toMatch(/^---\nname: hexacore-generate-ids-in-the-domain-entity\ndescription: ".*Use when in node projects: Tests fail/);
    expect(skill).toContain('## What to do');
    expect((await call('export_skills')).exported).toEqual([]);

    await call('rollback_changes', { checkpointId: exported.checkpointId });
    expect(await fs.exists(skillPath)).toBe(false);
  });
});

describe('lesson library', () => {
  it('shares proven lessons with other projects of the same stack and scores them there', async () => {
    const shop = setup([1]);
    const { lesson } = await shop.call('record_lesson', { ...lessonInput, stack: 'node' });
    expect((await shop.call('share_lessons')).shared).toEqual([]);
    for (let i = 0; i < 3; i++) await shop.call('rate_lesson', { lessonId: lesson.id, helpful: true });
    expect((await shop.call('resume_session')).briefing).toContain('can be shared with your other projects (share_lessons)');

    const shared = await shop.call('share_lessons');
    expect(shared.shared).toHaveLength(1);
    const libraryId = `library:${shared.shared[0].libraryId}`;
    expect(await shop.fs.readFile(shared.shared[0].file)).toContain('- **Shared from:** workspace');
    expect((await shop.call('share_lessons')).shared).toEqual([]);
    // The project that shared it keeps using its own copy, never the library one.
    expect((await shop.qa()).learning.suggestions.map((s: any) => s.id)).toEqual([lesson.id]);

    // Another project on the same machine, with no lessons of its own.
    const blog = setup([1, 0], { fs: shop.fs, root: path.resolve('/blog') });
    expect((await blog.call('resume_session')).briefing).toContain('Lesson library: 1 lesson(s) from your other projects');
    const red = await blog.qa();
    expect(red.learning.suggestions).toMatchObject([{ id: libraryId, origin: 'library' }]);
    await blog.edit(ENTITY, goodFix);
    const green = await blog.qa();
    expect(green.learning.resolved[0].creditedLessonIds).toEqual([libraryId]);

    const library = JSON.parse(await shop.fs.readFile(path.resolve('/home/.hexacore/learning.json')));
    expect(library.lessons[0].stats.helped).toBe(4);
    expect(library.lessons[0].projects).toEqual(['workspace', 'blog']);
    const rated = await blog.call('rate_lesson', { lessonId: libraryId, retire: true });
    expect(rated.status).toBe('retired');
    expect((await blog.call('review_lessons', { query: 'expected id' })).matches).toEqual([]);
  });
});

describe('lesson policy', () => {
  it('fingerprints failures independently of paths, numbers and quoted values', () => {
    const a = failureSignature('test', [{ errorMessage: "expected 3 to be 4 in /src/a/orders.ts ('abc')" }]);
    const b = failureSignature('test', [{ errorMessage: "Expected 10 to be 12 in /src/b/orders.ts ('xyz')\nstack…" }]);
    expect(a).toBe(b);
    expect(a).toBe('test:expected n to be n in <path> (<value>)');
  });

  it('scores with smoothing and gates export on evidence', () => {
    const lesson: any = { status: 'active', stats: { retrieved: 0, helped: 0, notHelped: 0 } };
    expect(effectiveness(lesson.stats)).toBe(0.5);
    lesson.stats = { retrieved: 5, helped: 3, notHelped: 0 };
    expect(isExportable(lesson)).toBe(true);
    lesson.stats = { retrieved: 5, helped: 0, notHelped: 3 };
    expect(nextStatus(lesson)).toBe('needs_review');
  });
});
