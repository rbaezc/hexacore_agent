import * as path from 'node:path';
import { IFileSystem } from '../../../shared/infrastructure/file_system.js';
import { WorkspaceContext } from '../../../shared/infrastructure/workspace.js';
import { ChangeJournal } from '../../../shared/infrastructure/change_journal.js';
import { Result, ok, fail } from '../../../shared/domain/result.js';
import { designTokens, inlineStyles } from '../domain/css_blocks.js';
import { PrototypeStore } from './prototype_store.js';

export interface PromoteInput {
  name: string;
  version?: number;
  /** An .html path in the workspace (the page is copied), or a slice/directory to port the design into. */
  target: string;
  overwrite?: boolean;
}

export type PromotionResult =
  | { mode: 'copied'; version: number; target: string; written: string[]; checkpointId: string }
  | {
      mode: 'port';
      version: number;
      target: string;
      tokens: { light: Record<string, string>; dark: Record<string, string> };
      html: string;
      steps: string[];
    };

/**
 * Takes an approved prototype into the project. A page target gets the files copied through a
 * checkpoint; any other target gets what a framework port needs (tokens, markup, steps), because
 * turning a page into components is the model's job, done with the regular scaffolding tools.
 */
export class PrototypePromoter {
  constructor(
    private readonly fileSystem: IFileSystem,
    private readonly workspace: WorkspaceContext,
    private readonly journal: ChangeJournal,
    private readonly store: PrototypeStore
  ) {}

  async promote(input: PromoteInput): Promise<Result<PromotionResult, Error>> {
    const named = PrototypeStore.normalizeName(input.name);
    if (named.isFailure) return fail(named.error);
    const meta = await this.store.get(named.value);
    if (meta.isFailure) return fail(meta.error);
    const version = input.version ?? meta.value.current;
    const files = await this.store.read(named.value, version);
    if (files.isFailure) return fail(files.error);
    const html = files.value.get('index.html') ?? '';

    const inside = this.workspace.resolveInside(input.target);
    if (inside.isFailure) return fail(inside.error);
    if (inside.value.startsWith(this.workspace.hexagenPath() + path.sep)) return fail(new Error('Promote into the project, not into .hexagen/.'));

    if (!/\.html?$/i.test(inside.value)) {
      const css = [...inlineStyles(html).map((s) => s.css), ...[...files.value].filter(([f]) => f.endsWith('.css')).map(([, c]) => c)];
      return ok({
        mode: 'port',
        version,
        target: this.workspace.relative(inside.value),
        tokens: designTokens(css),
        html,
        steps: [
          'Carry the design tokens over first (theme file, CSS variables or the framework\'s theme object), with both light and dark values.',
          'Split the page into components along its sections; keep the markup semantics (headings, labels, landmarks).',
          'Create the files with execute_scaffolding or your edits inside the target slice, following search_knowledge_base rules for the stack.',
          'Run run_quality_assurance with checks ["typecheck","test"], then checks ["ui"] with target set to the dev server URL (http://localhost:…) to compare with the prototype.',
        ],
      });
    }

    const targetDir = path.dirname(inside.value);
    const writes = [...files.value].map(([rel, content]) => ({ file: rel === 'index.html' ? inside.value : path.join(targetDir, rel), content }));
    if (!input.overwrite) {
      const existing: string[] = [];
      for (const w of writes) if (await this.fileSystem.exists(w.file)) existing.push(this.workspace.relative(w.file));
      if (existing.length) return fail(new Error(`${existing.join(', ')} already exist(s). Pass overwrite=true to replace them (the checkpoint keeps the old content).`));
    }
    const checkpoint = await this.journal.begin(`promote ${named.value} v${version} → ${this.workspace.relative(inside.value)}`);
    const written: string[] = [];
    for (const w of writes) {
      const res = await this.journal.write(checkpoint, w.file, w.content);
      if (res.isFailure) return fail(res.error);
      written.push(this.workspace.relative(w.file));
    }
    const recorded = await this.store.recordPromotion(meta.value, checkpoint, { version, target: this.workspace.relative(inside.value), checkpointId: checkpoint.id, at: new Date().toISOString() });
    if (recorded.isFailure) return fail(recorded.error);
    return ok({ mode: 'copied', version, target: this.workspace.relative(inside.value), written, checkpointId: checkpoint.id });
  }
}
