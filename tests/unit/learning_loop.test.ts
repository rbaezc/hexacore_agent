import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { createTestHexaCore, TEST_ROOT } from '../helpers/test_hexacore.js';
import { createToolRegistry } from '../../src/features/mcp_server/infrastructure/mcp_server_factory.js';
import { failureSignature, effectiveness, nextStatus, isExportable } from '../../src/features/learning/index.js';

const ctx = { reportProgress: async () => {} };

/** Workspace whose successive test runs report the given failure counts, driven through the MCP tools. */
function setup(testFailures: number[]) {
  const t = createTestHexaCore(testFailures);
  const registry = createToolRegistry(t.services);
  const call = async (tool: string, input: Record<string, unknown> = {}): Promise<any> => {
    const res = await registry.call(tool, input, ctx);
    if (res.isFailure) throw res.error;
    return res.value;
  };
  return { ...t, call, qa: () => call('run_quality_assurance', { stack: 'node' }) };
}

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
    const { qa, call, fs } = setup([1, 0, 1, 0]);
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

    // Same failure again: the lesson is offered, and credited when the check goes green.
    const red = await qa();
    expect(red.learning.suggestions.map((s: any) => s.id)).toEqual([recorded.lesson.id]);
    expect(red.learning.suggestions[0].content).toContain('crypto.randomUUID()');
    const green = await qa();
    expect(green.learning.resolved[0].creditedLessonIds).toEqual([recorded.lesson.id]);
    expect(green.learning.resolved[0].recurrences).toBe(1);

    const after = await call('review_lessons', { query: 'expected id' });
    expect(after.matches[0].effectiveness).toBeCloseTo(2 / 3, 2);
    // Resolved with a lesson on hand: not reported as experience still to distill.
    expect(after.unlearnedEpisodes).toEqual([]);
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
