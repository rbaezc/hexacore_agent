import { IFileSystem } from './file_system.js';
import { Result, ok, fail } from '../domain/result.js';

/**
 * A small JSON document on disk with read-modify-write under an in-process lock and atomic writes.
 * `normalize` turns whatever was parsed (possibly an older or partial shape) into a valid document.
 */
export class JsonFileStore<T> {
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly fileSystem: IFileSystem,
    private readonly filePath: () => string,
    private readonly normalize: (parsed: any) => T
  ) {}

  async load(): Promise<Result<T, Error>> {
    try {
      const file = this.filePath();
      if (!(await this.fileSystem.exists(file))) return ok(this.normalize({}));
      return ok(this.normalize(JSON.parse(await this.fileSystem.readFile(file))));
    } catch (error: any) {
      return fail(new Error(`Failed to load ${this.filePath()}: ${error.message}`));
    }
  }

  /** The mutator's return value is passed through. */
  async update<R>(mutate: (doc: T) => R): Promise<Result<R, Error>> {
    const run = this.writeQueue.then(async (): Promise<Result<R, Error>> => {
      const loaded = await this.load();
      if (loaded.isFailure) return fail(loaded.error);
      const value = mutate(loaded.value);
      try {
        await this.fileSystem.writeFileAtomic(this.filePath(), JSON.stringify(loaded.value, null, 2));
        return ok(value);
      } catch (error: any) {
        return fail(new Error(`Failed to save ${this.filePath()}: ${error.message}`));
      }
    });
    this.writeQueue = run.catch(() => undefined);
    return run;
  }
}
