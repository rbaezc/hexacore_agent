import * as path from 'node:path';
import { IFileSystem, DEFAULT_IGNORED_DIRS } from '../../../shared/infrastructure/file_system.js';
import { WorkspaceContext } from '../../../shared/infrastructure/workspace.js';
import { FixDiff } from '../domain/learning_types.js';
import { changedLines } from '../domain/fix_attribution.js';

const MAX_FILES = 5000;
const MAX_FILE_CHARS = 256 * 1024;
const MAX_TOTAL_CHARS = 32 * 1024 * 1024;
const MAX_DIFF_CHARS = 200 * 1024;

/** Text content of a project directory at one point in time (relative path → content). */
export type Snapshot = Map<string, string>;

/**
 * Captures the project when a check turns red and compares it with the project when it turns
 * green, so the learning loop knows what the fix actually changed. Plain file reads: no VCS needed.
 * Big, binary and ignored files (node_modules, build output, .hexagen…) are left out.
 */
export class WorkspaceSnapshots {
  constructor(
    private readonly fileSystem: IFileSystem,
    private readonly workspace: WorkspaceContext
  ) {}

  async take(cwd: string): Promise<Snapshot> {
    const dir = path.resolve(this.workspace.root, cwd);
    const files = (await this.fileSystem.listDirectory(dir, DEFAULT_IGNORED_DIRS)).slice(0, MAX_FILES);
    const snapshot: Snapshot = new Map();
    let total = 0;
    for (const file of files) {
      const content = await this.fileSystem.readFile(file).catch(() => undefined);
      if (content === undefined || content.length > MAX_FILE_CHARS || content.includes('\u0000')) continue;
      total += content.length;
      if (total > MAX_TOTAL_CHARS) break;
      snapshot.set(this.workspace.relative(file), content);
    }
    return snapshot;
  }

  static diff(before: Snapshot, after: Snapshot): FixDiff {
    const changedFiles = [...new Set([...before.keys(), ...after.keys()])].filter((f) => before.get(f) !== after.get(f)).sort();
    const changedText = changedFiles
      .flatMap((f) => changedLines(before.get(f), after.get(f)))
      .join('\n')
      .slice(0, MAX_DIFF_CHARS);
    return { changedFiles, changedText };
  }
}
