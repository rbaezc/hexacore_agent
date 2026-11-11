import * as path from 'node:path';
import { z } from 'zod';
import { ok, fail } from '../../../../shared/domain/result.js';
import { attachImages, attachedImages } from '../../../../shared/domain/attachments.js';
import type { HexaCoreServices } from '../../../../composition_root.js';
import { ToolDefinition } from '../../domain/mcp_types.js';

/** UI prototypes: save versions, preview them locally, and promote the approved one into the project. */
export function prototypeTools(s: HexaCoreServices): ToolDefinition[] {
  return [
    {
      name: 'create_prototype',
      title: 'Create or update a UI prototype',
      description:
        'Saves a version of an HTML prototype (a page, screen or flow) in .hexagen/prototypes/<name>/ and returns a local preview URL to show the user. ' +
        'Search the UI rules first (search_knowledge_base "ui conventions"). Pass the full page as html, or edits (exact oldText → newText) to change the current version. ' +
        'Static UI rules run on every save; run_quality_assurance with checks ["ui"] adds the browser check (phone/desktop, light/dark, screenshots). Each version is a checkpoint.',
      schema: () =>
        z.object({
          name: z.string().describe("Prototype name, e.g. 'landing' or 'checkout-flow'"),
          html: z.string().optional().describe('The full page (a complete HTML document with its own <style>)'),
          edits: z
            .array(z.object({ oldText: z.string(), newText: z.string() }))
            .optional()
            .describe('Changes to the base version instead of html; each oldText must appear exactly once'),
          files: z.array(z.object({ path: z.string(), content: z.string() })).optional().describe('Extra text files next to index.html (styles.css, app.js…)'),
          basedOn: z.number().int().min(1).optional().describe('Version to start from (default: the current one)'),
          target: z.string().optional().describe('Where it should end up, e.g. docs/index.html or src/features/landing'),
          note: z.string().optional().describe('What changed in this version'),
        }),
      handler: async (args) => {
        const saved = await s.prototypes.store.save(args);
        if (saved.isFailure) return fail(saved.error);
        const { meta, version, checkpointId } = saved.value;
        const audit = await s.prototypes.auditor.audit({ label: meta.name, cwd: saved.value.dir, files: version.files.filter((f) => /\.(html?|css)$/i.test(f)).map((f) => path.join(saved.value.dir, f)) }, { render: false });
        const previewUrl = await s.prototypes.preview.url(meta.name);
        const errors = audit.findings.filter((f) => f.severity === 'error');
        return ok({
          name: meta.name,
          version: version.version,
          basedOn: version.basedOn,
          files: version.files,
          dir: s.workspace.relative(saved.value.dir),
          previewUrl,
          checkpointId,
          staticAudit: { passed: errors.length === 0, findings: audit.findings },
          nextActions: [
            previewUrl ? `Show the user the preview: ${previewUrl} (it reloads by itself when you save a new version).` : 'Previews are disabled; the page is in the dir above.',
            ...(errors.length ? [`Fix the ${errors.length} static problem(s) above with edits before showing it.`] : []),
            `Run run_quality_assurance with checks ["ui"] and target "${meta.name}" for the browser check, then iterate with edits until it is green.`,
            `When the user approves it, promote_prototype into ${meta.target ?? 'its destination'}.`,
          ],
        });
      },
    },
    {
      name: 'list_prototypes',
      title: 'List UI prototypes',
      description: 'Prototypes in this project with their versions, intended target, promotions and preview URLs.',
      schema: () => z.object({}),
      annotations: { readOnlyHint: true },
      handler: async () => {
        const metas = await s.prototypes.store.list();
        return ok({
          prototypes: await Promise.all(
            metas.map(async (m) => ({
              name: m.name,
              current: m.current,
              versions: m.versions.map(({ version, createdAt, basedOn, note }) => ({ version, createdAt, basedOn, note })),
              target: m.target,
              promotions: m.promotions,
              previewUrl: await s.prototypes.preview.url(m.name),
            }))
          ),
          previewIndex: await s.prototypes.preview.url(),
        });
      },
    },
    {
      name: 'promote_prototype',
      title: 'Promote a prototype into the project',
      description:
        'Takes an approved prototype version into the project. An .html target gets the page copied through a checkpoint (overwrite=true to replace an existing file) and is audited there. ' +
        'Any other target (a slice or directory of a React, Flutter… app) returns the design tokens, the markup and the steps to port it into components.',
      schema: () =>
        z.object({
          name: z.string(),
          target: z.string().describe('docs/index.html, public/landing.html… or a slice directory such as src/features/landing'),
          version: z.number().int().min(1).optional().describe('Default: the current version'),
          overwrite: z.boolean().optional(),
        }),
      handler: async (args) => {
        const promoted = await s.prototypes.promoter.promote(args);
        if (promoted.isFailure) return fail(promoted.error);
        if (promoted.value.mode === 'port') return ok({ ...promoted.value, nextActions: promoted.value.steps });
        const stack = (await s.stackDetector.detectActiveStacks(s.workspace.root))[0] ?? 'node';
        const audit = await s.qaRunner.runCheck({ stack, scope: promoted.value.target }, 'ui');
        const result = {
          ...promoted.value,
          audit: audit.isSuccess ? audit.value : { error: audit.error.message },
          nextActions: [`Undo with rollback_changes '${promoted.value.checkpointId}' if needed.`],
        };
        return ok(attachImages(result, audit.isSuccess ? attachedImages(audit.value) : []));
      },
    },
  ];
}
