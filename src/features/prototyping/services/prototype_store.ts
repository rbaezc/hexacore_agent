import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { IFileSystem } from '../../../shared/infrastructure/file_system.js';
import { WorkspaceContext } from '../../../shared/infrastructure/workspace.js';
import { ChangeJournal } from '../../../shared/infrastructure/change_journal.js';
import { Result, ok, fail } from '../../../shared/domain/result.js';
import { Checkpoint } from '../../../shared/domain/checkpoint.js';
import { PrototypeInput, PrototypeMeta, SavedPrototype, TextEdit, UiTarget } from '../domain/prototype_types.js';

const NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;
const TEXT_FILE = /\.(html?|css|m?js|json|svg|txt|md)$/i;
const MAX_FILE_CHARS = 2 * 1024 * 1024;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Prototypes live in .hexagen/prototypes/<name>/ (the current version, served by the preview
 * server) with every version archived under .versions/ and metadata under .meta/. Each save is
 * one checkpoint, so rollback_changes undoes a version completely.
 */
export class PrototypeStore {
  constructor(
    private readonly fileSystem: IFileSystem,
    private readonly workspace: WorkspaceContext,
    private readonly journal: ChangeJournal
  ) {}

  root(): string {
    return this.workspace.hexagenPath('prototypes');
  }

  dir(name: string): string {
    return path.join(this.root(), name);
  }

  versionDir(name: string, version: number): string {
    return path.join(this.root(), '.versions', name, `v${version}`);
  }

  private metaFile(name: string): string {
    return path.join(this.root(), '.meta', `${name}.json`);
  }

  static normalizeName(raw: string): Result<string, Error> {
    const name = raw.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return NAME.test(name) ? ok(name) : fail(new Error(`Invalid prototype name '${raw}': use letters, digits and dashes (e.g. 'landing' or 'checkout-flow').`));
  }

  async list(): Promise<PrototypeMeta[]> {
    const files = await this.fileSystem.listDirectory(path.join(this.root(), '.meta'));
    const metas: PrototypeMeta[] = [];
    for (const file of files.filter((f) => f.endsWith('.json'))) {
      try {
        metas.push(JSON.parse(await this.fileSystem.readFile(file)));
      } catch {
        // a corrupt metadata file must not hide the other prototypes
      }
    }
    return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(name: string): Promise<Result<PrototypeMeta, Error>> {
    const file = this.metaFile(name);
    if (!(await this.fileSystem.exists(file))) return fail(new Error(`Prototype '${name}' not found. See list_prototypes.`));
    try {
      return ok(JSON.parse(await this.fileSystem.readFile(file)));
    } catch (error: any) {
      return fail(new Error(`Prototype '${name}' has corrupt metadata: ${error.message}`));
    }
  }

  /** The files of one version (relative path → content); the current version by default. */
  async read(name: string, version?: number): Promise<Result<Map<string, string>, Error>> {
    const meta = await this.get(name);
    if (meta.isFailure) return fail(meta.error);
    const entry = meta.value.versions.find((v) => v.version === (version ?? meta.value.current));
    if (!entry) return fail(new Error(`Prototype '${name}' has no version ${version}. Versions: ${meta.value.versions.map((v) => v.version).join(', ')}.`));
    const dir = this.versionDir(name, entry.version);
    const files = new Map<string, string>();
    for (const rel of entry.files) files.set(rel, await this.fileSystem.readFile(path.join(dir, rel)));
    return ok(files);
  }

  async save(input: PrototypeInput): Promise<Result<SavedPrototype, Error>> {
    const named = PrototypeStore.normalizeName(input.name);
    if (named.isFailure) return fail(named.error);
    const name = named.value;
    const existing = await this.get(name);
    const meta: PrototypeMeta = existing.isSuccess
      ? existing.value
      : { name, createdAt: new Date().toISOString(), updatedAt: '', current: 0, versions: [], promotions: [] };
    const base = input.basedOn ?? (existing.isSuccess ? meta.current : undefined);

    const files = new Map<string, string>();
    if (base !== undefined && existing.isSuccess) {
      const baseFiles = await this.read(name, base);
      if (baseFiles.isFailure) return fail(baseFiles.error);
      for (const [rel, content] of baseFiles.value) files.set(rel, content);
    } else if (input.basedOn !== undefined) {
      return fail(new Error(`Prototype '${name}' does not exist yet, so it has no version ${input.basedOn} to build on.`));
    }

    if (input.html !== undefined) files.set('index.html', input.html);
    else if (input.edits?.length) {
      const edited = applyEdits(files.get('index.html'), input.edits);
      if (edited.isFailure) return fail(edited.error);
      files.set('index.html', edited.value);
    } else if (!input.files?.length) {
      return fail(new Error('Give the page as html, or edits to apply to an existing version.'));
    }
    for (const extra of input.files ?? []) {
      const rel = extra.path.replace(/\\/g, '/').replace(/^\.\//, '');
      if (rel.startsWith('/') || rel.split('/').some((s) => s === '..' || s.startsWith('.')) || !TEXT_FILE.test(rel)) {
        return fail(new Error(`Invalid prototype file '${extra.path}': use a relative path to a text file (.html, .css, .js, .json, .svg…).`));
      }
      files.set(rel, extra.content);
    }
    if (!files.has('index.html')) return fail(new Error('A prototype needs an index.html (pass html).'));
    const tooBig = [...files].find(([, content]) => content.length > MAX_FILE_CHARS);
    if (tooBig) return fail(new Error(`'${tooBig[0]}' is larger than 2 MB; keep prototypes to hand-written pages and inline small assets only.`));

    const version = Math.max(0, ...meta.versions.map((v) => v.version)) + 1;
    const checkpoint = await this.journal.begin(`prototype ${name} v${version}`);
    for (const [rel, content] of files) {
      for (const target of [path.join(this.dir(name), rel), path.join(this.versionDir(name, version), rel)]) {
        const written = await this.journal.write(checkpoint, target, content);
        if (written.isFailure) return fail(written.error);
      }
    }
    const now = new Date().toISOString();
    meta.versions.push({ version, createdAt: now, basedOn: base, note: input.note, files: [...files.keys()].sort(), checkpointId: checkpoint.id });
    meta.current = version;
    meta.updatedAt = now;
    if (input.target) meta.target = input.target;
    const savedMeta = await this.journal.write(checkpoint, this.metaFile(name), JSON.stringify(meta, null, 2));
    if (savedMeta.isFailure) return fail(savedMeta.error);
    return ok({ meta, version: meta.versions[meta.versions.length - 1], dir: this.dir(name), checkpointId: checkpoint.id });
  }

  /** Records that a version was promoted; part of the promotion's checkpoint. */
  async recordPromotion(meta: PrototypeMeta, checkpoint: Checkpoint, promotion: PrototypeMeta['promotions'][number]): Promise<Result<string, Error>> {
    meta.promotions.push(promotion);
    return this.journal.write(checkpoint, this.metaFile(meta.name), JSON.stringify(meta, null, 2));
  }

  /**
   * What `run_quality_assurance` checks for 'ui': a prototype name (the latest one when omitted),
   * an HTML file or directory in the workspace, or a dev server on localhost.
   */
  async resolveTarget(spec?: string): Promise<Result<UiTarget, Error>> {
    if (!spec) {
      const latest = (await this.list())[0];
      if (!latest) return fail(new Error('No target for the ui check: pass target (a prototype name, an .html file or a http://localhost URL), or create a prototype first.'));
      spec = latest.name;
    }
    if (/^https?:\/\//i.test(spec)) {
      const host = new URL(spec).host.replace(/:\d+$/, '');
      if (!LOCAL_HOSTS.has(host)) return fail(new Error(`The ui check only opens local URLs (localhost, 127.0.0.1), not '${spec}'.`));
      return ok({ label: spec, cwd: this.workspace.root, files: [], url: spec });
    }
    if (NAME.test(spec)) {
      const meta = await this.get(spec);
      if (meta.isSuccess) {
        const entry = meta.value.versions.find((v) => v.version === meta.value.current)!;
        const dir = this.dir(spec);
        return ok({ label: spec, cwd: dir, files: entry.files.filter((f) => /\.(html?|css)$/i.test(f)).map((f) => path.join(dir, f)), prototype: { name: spec, version: entry.version } });
      }
    }
    const inside = this.workspace.resolveInside(spec);
    if (inside.isFailure) return fail(inside.error);
    let file = inside.value;
    if (!/\.html?$/i.test(file)) file = path.join(file, 'index.html');
    if (!(await this.fileSystem.exists(file))) return fail(new Error(`'${spec}' is not a prototype, an existing .html file or a localhost URL.`));
    const html = await this.fileSystem.readFile(file);
    const sheets: string[] = [];
    for (const m of html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi)) {
      const href = /href=["']([^"']+)["']/i.exec(m[0])?.[1];
      if (!href || /^([a-z]+:)?\/\//i.test(href)) continue;
      const sheet = this.workspace.resolveInside(path.join(path.dirname(file), href.split(/[?#]/)[0]));
      if (sheet.isSuccess && (await this.fileSystem.exists(sheet.value))) sheets.push(sheet.value);
    }
    return ok({ label: this.workspace.relative(file), cwd: path.dirname(file), files: [file, ...sheets], url: pathToFileURL(file).href });
  }
}

function applyEdits(html: string | undefined, edits: TextEdit[]): Result<string, Error> {
  if (html === undefined) return fail(new Error('There is no index.html to edit; pass html instead.'));
  let out = html;
  for (const [i, edit] of edits.entries()) {
    const first = out.indexOf(edit.oldText);
    if (!edit.oldText || first < 0) return fail(new Error(`Edit ${i + 1}: oldText was not found in the page. Copy it exactly from the current version.`));
    if (out.indexOf(edit.oldText, first + 1) >= 0) return fail(new Error(`Edit ${i + 1}: oldText appears more than once; include more surrounding text so it is unique.`));
    out = out.slice(0, first) + edit.newText + out.slice(first + edit.oldText.length);
  }
  return ok(out);
}
