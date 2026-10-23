import * as path from 'node:path';
import { IFileSystem } from './file_system.js';
import { WorkspaceContext } from './workspace.js';
import { Result, ok, fail } from '../domain/result.js';
import { Checkpoint, RollbackReport } from '../domain/checkpoint.js';

/**
 * Every file HexaCore writes goes through a checkpoint that remembers the original content,
 * so any agent action can be undone exactly — without git, and without touching changes the
 * developer made to other files in the meantime.
 */
export class ChangeJournal {
  constructor(
    private readonly fileSystem: IFileSystem,
    private readonly workspace: WorkspaceContext = new WorkspaceContext()
  ) {}

  async begin(label: string): Promise<Checkpoint> {
    const checkpoint: Checkpoint = {
      id: `cp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      label,
      createdAt: new Date().toISOString(),
      status: 'open',
      changes: [],
    };
    await this.persist(checkpoint);
    return checkpoint;
  }

  /** Writes a file inside the workspace, recording its pre-image the first time this checkpoint touches it. */
  async write(checkpoint: Checkpoint, filePath: string, content: string): Promise<Result<string, Error>> {
    const inside = this.workspace.resolveInside(filePath);
    if (inside.isFailure) return fail(inside.error);
    const absolute = inside.value;

    let change = checkpoint.changes.find((c) => c.path === absolute);
    if (!change) {
      const original = (await this.fileSystem.exists(absolute)) ? await this.fileSystem.readFile(absolute) : null;
      change = { path: absolute, original, written: content };
      checkpoint.changes.push(change);
    }
    change.written = content;

    // Journal first: if the process dies mid-write, the pre-image is already on disk.
    await this.persist(checkpoint);
    await this.fileSystem.writeFile(absolute, content);
    return ok(absolute);
  }

  async get(checkpointId: string): Promise<Result<Checkpoint, Error>> {
    if (!/^cp_[\w]+$/.test(checkpointId)) return fail(new Error(`Invalid checkpoint id '${checkpointId}'.`));
    const file = this.checkpointFile(checkpointId);
    if (!(await this.fileSystem.exists(file))) return fail(new Error(`Checkpoint '${checkpointId}' not found.`));
    return ok(JSON.parse(await this.fileSystem.readFile(file)) as Checkpoint);
  }

  async list(limit: number = 20): Promise<Checkpoint[]> {
    const files = await this.fileSystem.listDirectory(this.workspace.hexagenPath('checkpoints'));
    const checkpoints: Checkpoint[] = [];
    for (const file of files.filter((f) => f.endsWith('.json'))) {
      try {
        checkpoints.push(JSON.parse(await this.fileSystem.readFile(file)));
      } catch {
        // a corrupt journal entry must not hide the others
      }
    }
    return checkpoints.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }

  async rollback(checkpointId: string, force: boolean = false): Promise<Result<RollbackReport, Error>> {
    const loaded = await this.get(checkpointId);
    if (loaded.isFailure) return fail(loaded.error);
    const checkpoint = loaded.value;
    if (checkpoint.status === 'rolled_back') return fail(new Error(`Checkpoint '${checkpointId}' was already rolled back.`));

    const report: RollbackReport = { checkpointId, applied: false, restored: [], deleted: [], conflicts: [] };
    for (const change of checkpoint.changes) {
      const exists = await this.fileSystem.exists(change.path);
      const current = exists ? await this.fileSystem.readFile(change.path) : null;
      if (current !== change.written) report.conflicts.push(this.workspace.relative(change.path));
    }
    // All-or-nothing: a half-applied rollback would make the next attempt misreport conflicts.
    if (report.conflicts.length > 0 && !force) return ok(report);

    for (const change of [...checkpoint.changes].reverse()) {
      if (change.original === null) {
        await this.fileSystem.remove(change.path);
        report.deleted.push(this.workspace.relative(change.path));
      } else {
        await this.fileSystem.writeFile(change.path, change.original);
        report.restored.push(this.workspace.relative(change.path));
      }
    }

    report.applied = true;
    checkpoint.status = 'rolled_back';
    await this.persist(checkpoint);
    return ok(report);
  }

  private checkpointFile(id: string): string {
    return path.join(this.workspace.hexagenPath('checkpoints'), `${id}.json`);
  }

  private async persist(checkpoint: Checkpoint): Promise<void> {
    await this.fileSystem.writeFileAtomic(this.checkpointFile(checkpoint.id), JSON.stringify(checkpoint, null, 2));
  }
}
