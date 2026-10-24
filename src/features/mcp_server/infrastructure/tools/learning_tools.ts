import { z } from 'zod';
import { ok, fail } from '../../../../shared/domain/result.js';
import type { HexaCoreServices } from '../../../../composition_root.js';
import { SUPPORTED_STACKS } from '../../../../shared/domain/stack.js';
import { LessonInput } from '../../../learning/index.js';
import { ToolDefinition } from '../../domain/mcp_types.js';

const scopeEnum = z.enum(['any', ...SUPPORTED_STACKS] as [string, ...string[]]);

/** The learning loop: distill experience into lessons, score them by outcome, promote proven ones to skills. */
export function learningTools(s: HexaCoreServices): ToolDefinition[] {
  return [
    {
      name: 'record_lesson',
      title: 'Record a lesson',
      description:
        'Turns experience into a reusable lesson in .hexagen/skills/ (indexed by search_knowledge_base and suggested automatically when a similar check fails). Call after fixing a failure that run_quality_assurance reported as resolved (pass its episodeId), or whenever you learn a project-specific fix or convention. Pass updateId to improve an existing lesson instead of duplicating it.',
      schema: () =>
        z.object({
          title: z.string().min(3).describe('Short imperative name, e.g. "Register new Rust slices in mod.rs"'),
          problem: z.string().min(3).describe('When it applies: symptoms, error messages, situations'),
          solution: z.string().min(3).describe('What to do, as concrete steps or rules'),
          example: z.string().optional().describe('A short code example or before/after'),
          stack: scopeEnum.optional().describe('Stack it applies to (default: the episode stack, else "any")'),
          tags: z.array(z.string()).optional(),
          episodeId: z.string().optional().describe('The resolved failure this lesson was learned from'),
          updateId: z.string().optional().describe('Lesson id to rewrite (keeps its usage history)'),
        }),
      handler: async (args: LessonInput) => s.lessons.record(args),
    },
    {
      name: 'rate_lesson',
      title: 'Rate a lesson',
      description:
        'Feedback on a lesson that was suggested to you: helpful=true if it led to the fix, false if it was wrong or irrelevant. retire=true stops suggesting it (it stays on disk). Ratings and automatic outcomes drive ranking and export.',
      schema: () =>
        z.object({
          lessonId: z.string(),
          helpful: z.boolean().optional(),
          retire: z.boolean().optional(),
        }),
      handler: async (args: { lessonId: string; helpful?: boolean; retire?: boolean }) => {
        if (args.helpful === undefined && !args.retire) return fail(new Error('Pass helpful (true/false) and/or retire=true.'));
        return s.learning.rate(args.lessonId, args);
      },
    },
    {
      name: 'review_lessons',
      title: 'Review learned lessons',
      description:
        'Maintenance view of what HexaCore has learned: resolved failures without a lesson yet (with recurrence counts), lessons whose evidence says they are not helping (rewrite with record_lesson updateId, or retire), proven lessons ready to export as skills, and the most effective lessons. With query, searches lessons only.',
      schema: () =>
        z.object({
          query: z.string().optional().describe('Search lessons, e.g. "dotnet namespace error"'),
          stack: scopeEnum.optional(),
        }),
      annotations: { readOnlyHint: true },
      handler: async (args: { query?: string; stack?: string }) => {
        const stacks = args.stack && args.stack !== 'any' ? [args.stack as (typeof SUPPORTED_STACKS)[number]] : [];
        const summary = await s.learning.summary(stacks);
        if (summary.isFailure) return fail(summary.error);
        if (!args.query) return ok(summary.value);
        const matches = await s.learning.suggest(args.query, stacks[0], 5);
        if (matches.isFailure) return fail(matches.error);
        return ok({ ...summary.value, matches: matches.value });
      },
    },
    {
      name: 'export_skills',
      title: 'Export lessons as Claude Code skills',
      description:
        'Writes lessons as Claude Code skills (.claude/skills/hexacore-<name>/SKILL.md) so the client loads them natively. Without lessonIds exports every proven lesson (helped at least 3 times, at least 70% effective) not exported yet. Reversible through rollback_changes.',
      schema: () => z.object({ lessonIds: z.array(z.string()).optional() }),
      handler: async (args: { lessonIds?: string[] }) => s.lessons.exportSkills(args.lessonIds),
    },
  ];
}
