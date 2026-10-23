import * as path from 'node:path';
import { IFileSystem } from '../../src/shared/infrastructure/file_system.js';

/** Path-normalizing in-memory IFileSystem shared by unit tests. */
export class InMemoryFileSystem implements IFileSystem {
  readonly files = new Map<string, string>();

  constructor(seed: Record<string, string> = {}) {
    for (const [p, c] of Object.entries(seed)) this.files.set(path.resolve(p), c);
  }

  private key(p: string): string {
    return path.resolve(p);
  }

  async readFile(p: string): Promise<string> {
    const data = this.files.get(this.key(p));
    if (data === undefined) throw new Error(`ENOENT: ${p}`);
    return data;
  }
  async writeFile(p: string, c: string): Promise<void> {
    this.files.set(this.key(p), c);
  }
  async writeFileAtomic(p: string, c: string): Promise<void> {
    this.files.set(this.key(p), c);
  }
  async appendFile(p: string, c: string): Promise<void> {
    this.files.set(this.key(p), (this.files.get(this.key(p)) ?? '') + c);
  }
  async remove(p: string): Promise<void> {
    const k = this.key(p);
    for (const f of [...this.files.keys()]) if (f === k || f.startsWith(k + path.sep)) this.files.delete(f);
  }
  async exists(p: string): Promise<boolean> {
    const k = this.key(p);
    if (this.files.has(k)) return true;
    return [...this.files.keys()].some((f) => f.startsWith(k + path.sep));
  }
  async ensureDir(): Promise<void> {}
  async listDirectory(dir: string, ignoreDirs?: ReadonlySet<string>, maxDepth: number = Infinity): Promise<string[]> {
    const root = this.key(dir) + path.sep;
    return [...this.files.keys()].filter((f) => {
      if (!f.startsWith(root)) return false;
      const segments = f.slice(root.length).split(path.sep).slice(0, -1);
      return segments.length <= maxDepth && !segments.some((s) => ignoreDirs?.has(s));
    });
  }
}
