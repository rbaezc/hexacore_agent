import { IFileSystem } from '../../../shared/infrastructure/file_system.js';
import { WorkspaceContext } from '../../../shared/infrastructure/workspace.js';
import { Result, ok, fail } from '../../../shared/domain/result.js';
import { LearningStore } from '../domain/learning_types.js';

const MAX_EPISODES = 200;

/**
 * `.hexagen/learning.json`: lesson index + usage stats, episodes and currently open failures.
 * Separate from state.json so frequent stat updates don't churn the project manifest.
 */
export class LearningRepository {
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly fileSystem: IFileSystem,
    private readonly workspace: WorkspaceContext
  ) {}

  private get storePath(): string {
    return this.workspace.hexagenPath('learning.json');
  }

  async load(): Promise<Result<LearningStore, Error>> {
    try {
      if (!(await this.fileSystem.exists(this.storePath))) return ok(emptyStore());
      const parsed = JSON.parse(await this.fileSystem.readFile(this.storePath));
      return ok({
        version: 1,
        lessons: Array.isArray(parsed.lessons) ? parsed.lessons : [],
        episodes: Array.isArray(parsed.episodes) ? parsed.episodes : [],
        openFailures: Array.isArray(parsed.openFailures) ? parsed.openFailures : [],
      });
    } catch (error: any) {
      return fail(new Error(`Failed to load .hexagen/learning.json: ${error.message}`));
    }
  }

  /** Read-modify-write under an in-process lock; the mutator's return value is passed through. */
  async update<T>(mutate: (store: LearningStore) => T): Promise<Result<T, Error>> {
    const run = this.writeQueue.then(async (): Promise<Result<T, Error>> => {
      const loaded = await this.load();
      if (loaded.isFailure) return fail(loaded.error);
      const store = loaded.value;
      const value = mutate(store);
      store.episodes = store.episodes.slice(-MAX_EPISODES);
      try {
        await this.fileSystem.writeFileAtomic(this.storePath, JSON.stringify(store, null, 2));
        return ok(value);
      } catch (error: any) {
        return fail(new Error(`Failed to save .hexagen/learning.json: ${error.message}`));
      }
    });
    this.writeQueue = run.catch(() => undefined);
    return run;
  }
}

function emptyStore(): LearningStore {
  return { version: 1, lessons: [], episodes: [], openFailures: [] };
}
