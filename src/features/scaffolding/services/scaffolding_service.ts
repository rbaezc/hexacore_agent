import * as path from 'node:path';
import { IFileSystem } from '../../../shared/infrastructure/file_system.js';
import { WorkspaceContext } from '../../../shared/infrastructure/workspace.js';
import { Result, ok, fail } from '../../../shared/domain/result.js';
import { ChangeJournal } from '../../../shared/infrastructure/change_journal.js';
import { PlannedFile, Registration, ScaffoldOptions, ScaffoldResult } from '../domain/scaffold_types.js';
import { deriveSliceNames } from '../../../shared/domain/slice_names.js';
import { blueprintFor, selectFiles } from '../generators/stack_generators.js';
import { SlicePolicyLinter } from './slice_policy_linter.js';
import { ProjectProfileDetector } from './project_profile.js';

export class ScaffoldingService {
  private readonly profiles: ProjectProfileDetector;

  constructor(
    private readonly fileSystem: IFileSystem,
    private readonly workspace: WorkspaceContext = new WorkspaceContext(),
    private readonly journal: ChangeJournal = new ChangeJournal(fileSystem, workspace)
  ) {
    this.profiles = new ProjectProfileDetector(fileSystem);
  }

  async executeScaffolding(options: ScaffoldOptions): Promise<Result<ScaffoldResult, Error>> {
    try {
      const names = deriveSliceNames(options.sliceName);
      if (names.isFailure) return fail(names.error);

      const target = this.workspace.resolveInside(options.targetDir ?? '.');
      if (target.isFailure) return fail(target.error);
      const rootDir = target.value;

      const profile = await this.profiles.detect(options.stack, rootDir);
      const blueprint = blueprintFor(options.stack, names.value, profile);
      const files = selectFiles(blueprint, options.layer, options.includeTests ?? true);

      const violations = SlicePolicyLinter.lintGeneratedFiles(files);
      if (violations.length > 0) {
        return fail(new Error(`Scaffolding blocked by VSA policy violations: ${violations.map((v) => `[${v.rule}] ${v.filePath}: ${v.message}`).join(' | ')}`));
      }

      const planned: (PlannedFile & { absolute: string })[] = [];
      for (const file of files) {
        const inside = this.workspace.resolveInside(path.join(rootDir, file.path));
        if (inside.isFailure) return fail(inside.error);
        planned.push({
          absolute: inside.value,
          path: file.path,
          role: file.role,
          lines: file.content.split(/\r?\n/).length,
          exists: await this.fileSystem.exists(inside.value),
          content: file.content,
        });
      }

      const registrations = await this.planRegistrations(rootDir, options.layer === undefined || options.layer === 'full' ? (blueprint.registrations ?? []) : []);
      if (registrations.isFailure) return fail(registrations.error);

      const result: ScaffoldResult = {
        sliceName: names.value.snake,
        stack: options.stack,
        dryRun: Boolean(options.dryRun),
        createdFiles: [],
        plannedFiles: [...planned, ...registrations.value].map(({ absolute, content, ...rest }) => (options.dryRun ? { ...rest, content } : rest)),
        notes: blueprint.notes,
        success: true,
        message: '',
      };

      if (options.dryRun) {
        result.message = `Dry run: ${planned.length} file(s) would be written for slice '${names.value.snake}' (${planned.filter((p) => p.exists).length} already exist).`;
        return ok(result);
      }

      const conflicts = planned.filter((p) => p.exists);
      if (conflicts.length > 0 && !options.overwrite) {
        return fail(
          new Error(
            `Refusing to overwrite ${conflicts.length} existing file(s): ${conflicts.map((c) => c.path).join(', ')}. ` +
              'Inspect them with dryRun:true, or pass overwrite:true (the change stays reversible via rollback_changes).'
          )
        );
      }

      const checkpoint = await this.journal.begin(`scaffold ${options.stack} slice '${names.value.snake}' (${options.layer ?? 'full'})`);
      for (const file of [...planned, ...registrations.value]) {
        const written = await this.journal.write(checkpoint, file.absolute, file.content!);
        if (written.isFailure) return fail(written.error);
        result.createdFiles.push(written.value);
      }
      result.checkpointId = checkpoint.id;
      result.message = `Scaffolded slice '${names.value.snake}' for stack '${options.stack}': ${planned.length} file(s), checkpoint ${checkpoint.id}.`;
      return ok(result);
    } catch (error: any) {
      return fail(new Error(`Scaffolding failed: ${error.message}`));
    }
  }

  /** Host files to create or append to; already-satisfied registrations are dropped (idempotent). */
  private async planRegistrations(rootDir: string, registrations: Registration[]): Promise<Result<(PlannedFile & { absolute: string })[], Error>> {
    const planned: (PlannedFile & { absolute: string })[] = [];
    for (const reg of registrations) {
      const inside = this.workspace.resolveInside(path.join(rootDir, reg.path));
      if (inside.isFailure) return fail(inside.error);
      const exists = await this.fileSystem.exists(inside.value);
      const current = exists ? await this.fileSystem.readFile(inside.value) : '';
      if (exists && (!reg.line || current.split(/\r?\n/).some((l) => l.trim() === reg.line))) continue;
      const content = reg.line ? `${current}${current && !current.endsWith('\n') ? '\n' : ''}${reg.line}\n` : current;
      planned.push({ absolute: inside.value, path: reg.path, role: 'registration', lines: content.split(/\r?\n/).length, exists, content });
    }
    return ok(planned);
  }
}
