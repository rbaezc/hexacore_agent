import { IFileSystem } from '../../../shared/infrastructure/file_system.js';
import { Result, ok, fail } from '../../../shared/domain/result.js';
import { LearningStore } from '../domain/learning_types.js';

const MAX_EPISODES = 200;

/**
 * Lesson index + usage stats, episodes and currently open failures: `.hexagen/learning.json` for a
 * project (separate from state.json so frequent stat updates don't churn the project manifest),
 * `~/.hexacore/learning.json` for the user's library.
 */
export class LearningRepository {
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly fileSystem: IFileSystem,
    private readonly storePath: () => string
  ) {}

  async load(): Promise<Result<LearningStore, Error>> {
    try {
      if (!(await this.fileSystem.exists(this.storePath()))) return ok(emptyStore());
      const parsed = JSON.parse(await this.fileSystem.readFile(this.storePath()));
      return ok({
        version: 1,
        lessons: Array.isArray(parsed.lessons) ? parsed.lessons : [],
        episodes: Array.isArray(parsed.episodes) ? parsed.episodes : [],
        openFailures: Array.isArray(parsed.openFailures) ? parsed.openFailures : [],
      });
    } catch (error: any) {
      return fail(new Error(`Failed to load ${this.storePath()}: ${error.message}`));
    }
  }

  /** Read-modify-write under an in-process lock; the mutator's return value is passed through. */
  async update<T>(mutate: (store: LearningStore) => T): Promise<Result<T, Error>> {
    const run = this.writeQueue.then(async (): Promise<Result<T, Error>> => {
      let release: () => Promise<void>;
      try {
        release = await this.fileSystem.lock(this.storePath());
      } catch (error: any) {
        return fail(new Error(`Failed to lock ${this.storePath()}: ${error.message}`));
      }
      try {
        const loaded = await this.load();
        if (loaded.isFailure) return fail(loaded.error);
        const store = loaded.value;
        const value = mutate(store);
        store.episodes = store.episodes.slice(-MAX_EPISODES);
        await this.fileSystem.writeFileAtomic(this.storePath(), JSON.stringify(store, null, 2));
        return ok(value);
      } catch (error: any) {
        return fail(new Error(`Failed to save ${this.storePath()}: ${error.message}`));
      } finally {
        await release();
      }
    });
    this.writeQueue = run.catch(() => undefined);
    return run;
  }
}

function emptyStore(): LearningStore {
  return { version: 1, lessons: [], episodes: [], openFailures: [] };
}
