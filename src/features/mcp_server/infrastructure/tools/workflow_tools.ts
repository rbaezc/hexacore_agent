import { z } from 'zod';
import { ok, fail } from '../../../../shared/domain/result.js';
import type { HexaCoreServices } from '../../../../composition_root.js';
import { ToolDefinition } from '../../domain/mcp_types.js';
import { stackEnum } from './core_tools.js';

const sliceSchema = z.object({
  name: z.string().describe("Slice name, e.g. 'orders'"),
  description: z.string().optional(),
  layer: z.enum(['domain', 'application', 'infrastructure', 'presentation', 'full']).optional(),
});

const fieldSchema = z.object({
  name: z.string(),
  type: z.enum(['string', 'integer', 'number', 'boolean', 'datetime']),
  required: z.boolean().optional(),
  description: z.string().optional(),
});

/** Orchestration, change control, design records and session memory tools. */
export function workflowTools(s: HexaCoreServices): ToolDefinition[] {
  return [
    {
      name: 'orchestrate_task',
      title: 'Run a feature plan',
      description:
        'Executes a plan for a requirement: rules retrieval → scaffold each slice → architecture check → quality checks (with auto-fix through the client model when sampling is available). YOU decompose the requirement into slices; the plan is persisted and can be continued with resume_plan.',
      schema: (stacks) =>
        z.object({
          description: z.string().describe('The requirement in plain language'),
          targetStack: stackEnum(stacks),
          slices: z.array(sliceSchema).optional().describe('Decomposition into vertical slices'),
          sliceName: z.string().optional().describe('Shorthand for a single slice'),
          targetDir: z.string().optional(),
          overwrite: z.boolean().optional(),
          qaChecks: z.array(z.enum(['test', 'typecheck', 'lint', 'build'])).optional().describe('Default ["test"]'),
          autoFix: z.boolean().optional().describe('Allow sampling-based fixes (default true when supported)'),
        }),
      handler: async (args) => s.orchestrator.orchestrate({ id: `req_${Date.now()}`, ...args }),
    },
    {
      name: 'resume_plan',
      title: 'Resume a plan',
      description: 'Continues a persisted plan from its first unfinished step (ids come from resume_session or orchestrate_task).',
      schema: () => z.object({ planId: z.string(), autoFix: z.boolean().optional() }),
      handler: async (args: { planId: string; autoFix?: boolean }) => s.orchestrator.resume(args.planId, args.autoFix),
    },
    {
      name: 'list_checkpoints',
      title: 'List checkpoints',
      description: 'Lists recent checkpoints: every set of files HexaCore wrote (scaffolds, auto-fixes, ADRs, contracts), newest first.',
      schema: () => z.object({ limit: z.number().int().min(1).max(100).optional() }),
      annotations: { readOnlyHint: true },
      handler: async (args: { limit?: number }) => {
        const checkpoints = await s.journal.list(args.limit ?? 20);
        return ok(checkpoints.map((c) => ({ id: c.id, label: c.label, createdAt: c.createdAt, status: c.status, files: c.changes.map((ch) => s.workspace.relative(ch.path)) })));
      },
    },
    {
      name: 'rollback_changes',
      title: 'Roll back a checkpoint',
      description:
        'Restores every file of a checkpoint to its previous content (files it created are deleted). Refuses, changing nothing, if any of those files was edited afterwards unless force=true — confirm with the user before forcing.',
      schema: () => z.object({ checkpointId: z.string(), force: z.boolean().optional() }),
      annotations: { destructiveHint: true },
      handler: async (args: { checkpointId: string; force?: boolean }) => s.journal.rollback(args.checkpointId, args.force ?? false),
    },
    {
      name: 'record_decision',
      title: 'Record an architecture decision',
      description:
        'Writes an ADR to docs/adr/NNNN-title.md and indexes it, so the decision is retrievable via search_knowledge_base in later sessions. Use when choosing between design alternatives.',
      schema: () =>
        z.object({
          title: z.string(),
          context: z.string().describe('The forces and constraints at play'),
          decision: z.string(),
          consequences: z.string().describe('What becomes easier or harder'),
          alternatives: z.array(z.string()).optional(),
          status: z.enum(['proposed', 'accepted']).optional(),
          tags: z.array(z.string()).optional(),
        }),
      handler: async (args) => s.decisions.record(args),
    },
    {
      name: 'define_contract',
      title: 'Define a slice API contract',
      description: 'Contract-first design: writes contracts/<slice>.openapi.yaml (OpenAPI 3.1) from a list of operations, before implementing them.',
      schema: () =>
        z.object({
          sliceName: z.string(),
          title: z.string().optional(),
          version: z.string().optional(),
          outputDir: z.string().optional().describe('Default "contracts"'),
          operations: z
            .array(
              z.object({
                method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
                path: z.string().describe('Relative to the slice: "/" or "/{id}"'),
                summary: z.string(),
                request: z.array(fieldSchema).optional(),
                response: z.array(fieldSchema).optional(),
                successStatus: z.number().int().optional(),
              })
            )
            .min(1),
        }),
      handler: async (args) => s.contracts.define(args),
    },
    {
      name: 'record_handoff',
      title: 'Record a session handoff',
      description: 'Saves where this session stopped and what comes next; resume_session shows it to the next session. Call before ending a work session.',
      schema: () =>
        z.object({
          summary: z.string(),
          nextSteps: z.array(z.string()).optional(),
          openQuestions: z.array(z.string()).optional(),
        }),
      handler: async (args: { summary: string; nextSteps?: string[]; openQuestions?: string[] }) => {
        const note = {
          id: `handoff_${Date.now()}`,
          summary: args.summary,
          nextSteps: args.nextSteps ?? [],
          openQuestions: args.openQuestions ?? [],
          createdAt: new Date().toISOString(),
        };
        const saved = await s.stateRepo.addHandoff(note);
        return saved.isSuccess ? ok(note) : fail(saved.error);
      },
    },
  ];
}
