import { z } from 'zod';
import { ok, fail } from '../../../../shared/domain/result.js';
import type { HexaCoreServices } from '../../../../composition_root.js';
import { SupportedStack } from '../../../../shared/domain/stack.js';
import { buildBriefing } from '../../../state_management/index.js';
import { QACheck } from '../../../quality_assurance/index.js';
import { LearningSummary, ObservationReport } from '../../../learning/index.js';
import { ToolDefinition } from '../../domain/mcp_types.js';

export const stackEnum = (stacks: readonly SupportedStack[]) => z.enum(stacks as [SupportedStack, ...SupportedStack[]]);
const checkEnum = z.enum(['test', 'typecheck', 'lint', 'build']);
const layerEnum = z.enum(['domain', 'application', 'infrastructure', 'presentation', 'full']);

/** Session, knowledge, scaffolding, QA and architecture tools. */
export function coreTools(s: HexaCoreServices): ToolDefinition[] {
  return [
    {
      name: 'resume_session',
      title: 'Resume session',
      description:
        'Call first in every session. Returns a briefing of where work stopped (unfinished plans, last QA results, recent decisions, last handoff, checkpoints) plus the workspace root and detected stacks.',
      schema: () => z.object({}),
      annotations: { readOnlyHint: true },
      handler: async () => {
        const detected = await s.stackDetector.detect(s.workspace.root);
        const stacks = [...new Set(detected.map((d) => d.stack))];
        const state = await s.stateRepo.update((st) => {
          st.metadata.activeStacks = stacks;
        });
        if (state.isFailure) return fail(state.error);
        const checkpoints = (await s.journal.list(5)).map(({ id, label, createdAt, status }) => ({ id, label, createdAt, status }));
        const briefing = buildBriefing(state.value, checkpoints);
        const learning = await s.learning.summary(stacks);
        const learned = learning.isSuccess ? learningLines(learning.value) : '';
        if (learned) briefing.briefing = `${briefing.briefing.replace(/\nNo previous work recorded\.$/, '')}${learned}`;
        return ok({
          workspace: { root: s.workspace.root, stacks: detected },
          autoFixAvailable: Boolean(s.llm.client),
          ...briefing,
          learning: learning.isSuccess ? learning.value : undefined,
        });
      },
    },
    {
      name: 'search_knowledge_base',
      title: 'Search architecture rules',
      description:
        'BM25 search (English/Spanish) over HexaCore rules, the project rules in .hexagen/rules/ and the ADRs in docs/adr/. Use before designing or changing code to respect conventions.',
      schema: () =>
        z.object({
          query: z.string().min(2).describe('What you need to know, e.g. "repository layer rules for go"'),
          topK: z.number().int().min(1).max(10).optional().describe('Number of snippets (default 3)'),
        }),
      annotations: { readOnlyHint: true },
      handler: async (args: { query: string; topK?: number }) => s.ragEngine.searchRules(args.query, args.topK ?? 3),
    },
    {
      name: 'execute_scaffolding',
      title: 'Scaffold a vertical slice',
      description:
        'Generates a VSA slice (domain, application, infrastructure, presentation, composition module and tests) adapted to the host project. Never overwrites existing files unless overwrite=true; use dryRun=true to preview. Every write is recorded in a checkpoint (see rollback_changes).',
      schema: (stacks) =>
        z.object({
          stack: stackEnum(stacks),
          sliceName: z.string().describe("Feature name, e.g. 'orders' or 'user-profile'"),
          layer: layerEnum.optional().describe('One layer only, or the full slice (default)'),
          targetDir: z.string().optional().describe('Project directory relative to the workspace (monorepos)'),
          dryRun: z.boolean().optional().describe('Return the planned files and their content without writing'),
          overwrite: z.boolean().optional().describe('Replace files that already exist'),
          includeTests: z.boolean().optional().describe('Generate the slice tests (default true)'),
        }),
      handler: async (args) => s.scaffolding.executeScaffolding(args),
    },
    {
      name: 'run_quality_assurance',
      title: 'Run quality checks',
      description:
        "Runs the stack's native tools and returns structured results (counts, failing tests with file/line, diagnostics). checks: test (default), typecheck, lint, build. Checks whose tool isn't installed are reported as skipped, never as passed.",
      schema: (stacks) =>
        z.object({
          stack: stackEnum(stacks),
          checks: z.array(checkEnum).min(1).optional().describe('Default ["test"]'),
          scope: z.string().optional().describe('Extra runner arguments, e.g. a test file or filter'),
          cwd: z.string().optional().describe('Project directory relative to the workspace (default: where the stack was detected)'),
        }),
      handler: async (args: { stack: SupportedStack; checks?: QACheck[]; scope?: string; cwd?: string }, ctx) => {
        const cwdRel = args.cwd ?? (await s.stackDetector.detect(s.workspace.root)).find((d) => d.stack === args.stack)?.dir ?? '.';
        const cwd = s.workspace.resolveInside(cwdRel);
        if (cwd.isFailure) return fail(cwd.error);

        let lastProgress = 0;
        const onOutput = (chunk: string) => {
          const now = Date.now();
          const line = chunk.trim().split(/\r?\n/).pop();
          if (line && now - lastProgress > 1000) {
            lastProgress = now;
            void ctx.reportProgress(line.slice(0, 200));
          }
        };
        const results = await s.qaRunner.runChecks({ stack: args.stack, scope: args.scope, cwd: cwd.value, onOutput }, args.checks ?? ['test']);
        if (results.isFailure) return fail(results.error);
        for (const r of results.value) {
          await s.stateRepo.recordQaRun({ stack: r.stack, check: r.check, status: r.status, failed: r.failedTestsCount, total: r.totalTests, at: new Date().toISOString() });
        }
        const verified = results.value.filter((r) => r.status !== 'skipped');
        const observed = await s.learning.observe(results.value, s.workspace.relative(cwd.value));
        const learning = observed.isSuccess ? observed.value : undefined;
        return ok({
          passed: verified.length > 0 && verified.every((r) => r.passed),
          cwd: s.workspace.relative(cwd.value),
          results: results.value,
          learning,
          nextActions: learningActions(learning),
        });
      },
    },
    {
      name: 'check_architecture',
      title: 'Check VSA architecture',
      description:
        'Read-only audit of the codebase against the VSA rules: cross-slice coupling, layer dependency direction (domain must not depend on outer layers…) and the 250-line file limit. Run after changing code.',
      schema: () => z.object({ path: z.string().optional().describe('Sub-directory to audit, relative to the workspace (default: whole workspace)') }),
      annotations: { readOnlyHint: true },
      handler: async (args: { path?: string }) => s.architecture.check(args.path ?? '.'),
    },
  ];
}

/** Turns a QA observation into explicit instructions, so the model actually closes the learning loop. */
function learningActions(report?: ObservationReport): string[] {
  if (!report) return [];
  const actions: string[] = [];
  if (report.suggestions.length) {
    actions.push(`Learned lessons match these failures (see learning.suggestions): apply them first, then rate_lesson with helpful=true/false.`);
  }
  for (const e of report.resolved) {
    const recurring = e.recurrences ? ` This problem has happened ${e.recurrences + 1} times.` : '';
    actions.push(`${e.stack} ${e.check} went green (episode ${e.id}: ${e.summary}).${recurring} If the fix generalizes, call record_lesson with episodeId '${e.id}'.`);
  }
  return actions;
}

function learningLines(summary: LearningSummary): string {
  const lines: string[] = [];
  if (summary.topLessons.length) lines.push(`Learned lessons (${summary.active} active): ${summary.topLessons.map((l) => `${l.title} [${Math.round(l.effectiveness * 100)}%]`).join('; ')}.`);
  if (summary.unlearnedEpisodes.length) lines.push(`${summary.unlearnedEpisodes.length} resolved failure(s) have no lesson yet — see review_lessons.`);
  if (summary.needsReview.length) lines.push(`Lessons that aren't helping: ${summary.needsReview.map((l) => l.title).join('; ')} — rewrite or retire (review_lessons).`);
  if (summary.exportable.length) lines.push(`${summary.exportable.length} proven lesson(s) can become Claude Code skills (export_skills).`);
  return lines.length ? `\n${lines.join('\n')}` : '';
}
