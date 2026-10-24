import { Lesson, LessonInput } from '../domain/learning_types.js';
import { effectiveness } from '../domain/lesson_policy.js';

/**
 * Lesson markdown in `.hexagen/skills/`. Plain headings so the RAG engine indexes each part, and
 * people can review, edit and version lessons like any other project rule.
 */
export function renderLesson(input: LessonInput, meta: { stack: string; version: number; learnedFrom?: string }): string {
  return [
    `# ${input.title.trim()}`,
    '',
    `- **Stack:** ${meta.stack}`,
    input.tags?.length ? `- **Tags:** ${input.tags.join(', ')}` : '',
    `- **Version:** ${meta.version}`,
    meta.learnedFrom ? `- **Learned from:** ${meta.learnedFrom}` : '',
    '',
    '## When it applies',
    '',
    input.problem.trim(),
    '',
    '## What to do',
    '',
    input.solution.trim(),
    '',
    input.example?.trim() ? `## Example\n\n${input.example.trim()}\n` : '',
  ]
    .filter((line, i, all) => !(line === '' && all[i - 1] === ''))
    .join('\n');
}

/** The parts of a lesson document below its metadata list (what a skill or a prompt needs). */
export function lessonBody(markdown: string): string {
  const start = markdown.search(/^## /m);
  return (start >= 0 ? markdown.slice(start) : markdown).trim();
}

/**
 * Claude Code skill (`.claude/skills/<name>/SKILL.md`). The description says *when* to use it,
 * which is what the client matches against to load the skill.
 */
export function renderSkill(lesson: Lesson, markdown: string): { name: string; content: string } {
  const name = `hexacore-${lesson.slug}`.slice(0, 64);
  const scope = lesson.stack === 'any' ? '' : ` in ${lesson.stack} projects`;
  const description = `${lesson.title}. Use when${scope}: ${lesson.problem}`.replace(/\s+/g, ' ').slice(0, 1000);
  const evidence = `${lesson.stats.helped} resolved failure(s), effectiveness ${Math.round(effectiveness(lesson.stats) * 100)}%`;
  const content = [
    '---',
    `name: ${name}`,
    `description: ${JSON.stringify(description)}`,
    '---',
    '',
    `# ${lesson.title}`,
    '',
    lessonBody(markdown),
    '',
    `_Learned by HexaCore from experience in this project (${evidence}). Source: ${lesson.file}._`,
    '',
  ].join('\n');
  return { name, content };
}
