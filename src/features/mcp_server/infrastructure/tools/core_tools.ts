import { z } from 'zod';
import { ok, fail } from '../../../../shared/domain/result.js';
import { attachImages, attachedImages } from '../../../../shared/domain/attachments.js';
import type { HexaCoreServices } from '../../../../composition_root.js';
import { SupportedStack } from '../../../../shared/domain/stack.js';
import { buildBriefing } from '../../../state_management/index.js';
import { QACheck, QAResult } from '../../../quality_assurance/index.js';
import { LearningSummary, ObservationReport } from '../../../learning/index.js';
import { UserProfile } from '../../../user_profile/index.js';
import { ToolDefinition } from '../../domain/mcp_types.js';

export const stackEnum = (stacks: readonly SupportedStack[]) => z.enum(stacks as [SupportedStack, ...SupportedStack[]]);
const checkEnum = z.enum(['test', 'typecheck', 'lint', 'build', 'ui']);
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
        const profile = await s.profile.profile();
        const extra = `${profile.isSuccess ? profileLines(profile.value) : ''}${learning.isSuccess ? learningLines(learning.value) : ''}`;
        if (extra) briefing.briefing = `${briefing.briefing.replace(/\nNo previous work recorded\.$/, '')}${extra}`;
        return ok({
          workspace: { root: s.workspace.root, stacks: detected },
          autoFixAvailable: Boolean(s.llm.client),
          ...briefing,
          learning: learning.isSuccess ? learning.value : undefined,
          profile: profile.isSuccess ? profile.value : undefined,
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
        "Runs the stack's native tools and returns structured results (counts, failing tests with file/line, diagnostics). checks: test (default), typecheck, lint, build, ui. Checks whose tool isn't installed are reported as skipped, never as passed. " +
        'ui audits a page instead of code (target: a prototype name, an .html file or a http://localhost dev server): static rules always, plus phone/desktop and light/dark rendering with screenshots when Playwright is installed.',
      schema: (stacks) =>
        z.object({
          stack: stackEnum(stacks),
          checks: z.array(checkEnum).min(1).optional().describe('Default ["test"]'),
          scope: z.string().optional().describe('Extra runner arguments, e.g. a test file or filter'),
          cwd: z.string().optional().describe('Project directory relative to the workspace (default: where the stack was detected)'),
          target: z.string().optional().describe('For the ui check: a prototype name (default: the latest), an .html file or a http://localhost URL'),
        }),
      handler: async (args: { stack: SupportedStack; checks?: QACheck[]; scope?: string; cwd?: string; target?: string }, ctx) => {
        const checks = args.checks ?? ['test'];
        const cwdRel = args.cwd ?? (await s.stackDetector.detect(s.workspace.root)).find((d) => d.stack === args.stack)?.dir ?? '.';
        const cwd = s.workspace.resolveInside(cwdRel);
        if (cwd.isFailure) return fail(cwd.error);
        // The ui check runs in the audited page's directory, so learning compares that page before and after a fix.
        const uiTarget = checks.includes('ui') ? await s.prototypes.store.resolveTarget(args.target) : undefined;
        if (uiTarget?.isFailure) return fail(uiTarget.error);
        const runs = [
          { cwd: cwd.value, checks: checks.filter((c) => c !== 'ui'), scope: args.scope },
          ...(uiTarget?.isSuccess ? [{ cwd: uiTarget.value.cwd, checks: ['ui' as QACheck], scope: args.target ?? uiTarget.value.label }] : []),
        ].filter((r) => r.checks.length);

        let lastProgress = 0;
        const onOutput = (chunk: string) => {
          const now = Date.now();
          const line = chunk.trim().split(/\r?\n/).pop();
          if (line && now - lastProgress > 1000) {
            lastProgress = now;
            void ctx.reportProgress(line.slice(0, 200));
          }
        };
        const all: QAResult[] = [];
        let learning: ObservationReport | undefined;
        for (const run of runs) {
          const results = await s.qaRunner.runChecks({ stack: args.stack, scope: run.scope, cwd: run.cwd, onOutput }, run.checks);
          if (results.isFailure) return fail(results.error);
          for (const r of results.value) {
            await s.stateRepo.recordQaRun({ stack: r.stack, check: r.check, status: r.status, failed: r.failedTestsCount, total: r.totalTests, at: new Date().toISOString() });
          }
          const observed = await s.learning.observe(results.value, s.workspace.relative(run.cwd));
          if (observed.isSuccess) learning = mergeObservations(learning, observed.value);
          all.push(...results.value);
        }
        const verified = all.filter((r) => r.status !== 'skipped');
        return ok(
          attachImages(
            {
              passed: verified.length > 0 && verified.every((r) => r.passed),
              cwd: s.workspace.relative(cwd.value),
              results: all,
              learning,
              nextActions: learningActions(learning),
            },
            all.flatMap((r) => attachedImages(r))
          )
        );
      },
    },
    {
      name: 'check_architecture',
      title: 'Check VSA architecture',
      description:
        'Read-only audit of the codebase against the VSA rules: cross-slice coupling, layer dependency direction (domain must not depend on outer layers…) and the 250-line file limit. Slices listed in hexacore.json architecture.compositionSlices may use other slices\' public modules. Run after changing code.',
      schema: () =>
        z.object({
          path: z.string().optional().describe('Sub-directory to audit, relative to the workspace (default: whole workspace)'),
          strict: z.boolean().optional().describe('Fail on warnings too'),
        }),
      annotations: { readOnlyHint: true },
      handler: async (args: { path?: string; strict?: boolean }) => s.architecture.check(args.path ?? '.', { strict: args.strict }),
    },
  ];
}

function mergeObservations(a: ObservationReport | undefined, b: ObservationReport): ObservationReport {
  return a ? { resolved: [...a.resolved, ...b.resolved], suggestions: [...a.suggestions, ...b.suggestions] } : b;
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
    const touched = e.changedFiles.length ? ` The fix changed ${e.changedFiles.slice(0, 5).join(', ')}${e.changedFiles.length > 5 ? '…' : ''}.` : '';
    actions.push(`${e.stack} ${e.check} went green (episode ${e.id}: ${e.summary}).${touched}${recurring} If the fix generalizes, call record_lesson with episodeId '${e.id}'.`);
    if (e.unconfirmedLessonIds.length) {
      actions.push(`The fix doesn't resemble lesson(s) ${e.unconfirmedLessonIds.join(', ')}, so they were not credited. If one did help, rate_lesson with helpful=true.`);
    }
  }
  return actions;
}

/** How this user works, first in the briefing so the model adapts before doing anything. */
function profileLines(profile: UserProfile): string {
  const lines = [
    ...profile.preferences.map((p) => `- ${p.text}${p.scope === 'project' ? ' (this project)' : ''}`),
    ...profile.habits.map((h) => `- ${h.text} (observed)`),
  ];
  return lines.length ? `\nHow this user works (follow these unless told otherwise):\n${lines.join('\n')}` : '';
}

function learningLines(summary: LearningSummary): string {
  const lines: string[] = [];
  if (summary.topLessons.length) lines.push(`Learned lessons (${summary.active} active): ${summary.topLessons.map((l) => `${l.title} [${Math.round(l.effectiveness * 100)}%]`).join('; ')}.`);
  if (summary.unlearnedEpisodes.length) lines.push(`${summary.unlearnedEpisodes.length} resolved failure(s) have no lesson yet — see review_lessons.`);
  if (summary.needsReview.length) lines.push(`Lessons that aren't helping: ${summary.needsReview.map((l) => l.title).join('; ')} — rewrite or retire (review_lessons).`);
  if (summary.exportable.length) lines.push(`${summary.exportable.length} proven lesson(s) can become Claude Code skills (export_skills).`);
  if (summary.duplicates.length) lines.push(`${summary.duplicates.length} pair(s) of lessons say nearly the same thing — merge them (merge_lessons; see review_lessons).`);
  if (summary.shareable.length) lines.push(`${summary.shareable.length} proven lesson(s) can be shared with your other projects (share_lessons).`);
  if (summary.library?.lessons) lines.push(`Lesson library: ${summary.library.lessons} lesson(s) from your other projects apply here; they are suggested when a check fails.`);
  return lines.length ? `\n${lines.join('\n')}` : '';
}
