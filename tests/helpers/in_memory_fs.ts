import * as path from 'node:path';
import { IFileSystem } from '../../src/shared/infrastructure/file_system.js';

/** Path-normalizing in-memory IFileSystem shared by unit tests. */
export class InMemoryFileSystem implements IFileSystem {
  readonly files = new Map<string, string>();
  /** Directories that exist explicitly (parents of written files); empty ones survive file removal, as on disk. */
  readonly dirs = new Set<string>();

  constructor(seed: Record<string, string> = {}) {
    for (const [p, c] of Object.entries(seed)) this.put(path.resolve(p), c);
  }

  private key(p: string): string {
    return path.resolve(p);
  }

  private put(k: string, c: string): void {
    this.files.set(k, c);
    for (let d = path.dirname(k); d !== path.dirname(d); d = path.dirname(d)) this.dirs.add(d);
  }

  private under(k: string): boolean {
    const prefix = k + path.sep;
    return [...this.files.keys(), ...this.dirs].some((e) => e.startsWith(prefix));
  }

  async readFile(p: string): Promise<string> {
    const data = this.files.get(this.key(p));
    if (data === undefined) throw new Error(`ENOENT: ${p}`);
    return data;
  }
  async writeFile(p: string, c: string): Promise<void> {
    this.put(this.key(p), c);
  }
  async writeFileAtomic(p: string, c: string): Promise<void> {
    this.put(this.key(p), c);
  }
  async appendFile(p: string, c: string): Promise<void> {
    this.put(this.key(p), (this.files.get(this.key(p)) ?? '') + c);
  }
  async remove(p: string): Promise<void> {
    const k = this.key(p);
    for (const f of [...this.files.keys()]) if (f === k || f.startsWith(k + path.sep)) this.files.delete(f);
    for (const d of [...this.dirs]) if (d === k || d.startsWith(k + path.sep)) this.dirs.delete(d);
  }
  async removeEmptyDir(p: string): Promise<boolean> {
    const k = this.key(p);
    if (!this.dirs.has(k) || this.under(k)) return false;
    return this.dirs.delete(k);
  }
  async exists(p: string): Promise<boolean> {
    const k = this.key(p);
    return this.files.has(k) || this.dirs.has(k) || this.under(k);
  }
  async ensureDir(): Promise<void> {}
  /** One process, so the in-process queues of the stores are enough. */
  async lock(): Promise<() => Promise<void>> {
    return async () => {};
  }
  async listDirectory(dir: string, ignoreDirs?: ReadonlySet<string>, maxDepth: number = Infinity): Promise<string[]> {
    const root = this.key(dir) + path.sep;
    return [...this.files.keys()].filter((f) => {
      if (!f.startsWith(root)) return false;
      const segments = f.slice(root.length).split(path.sep).slice(0, -1);
      return segments.length <= maxDepth && !segments.some((s) => ignoreDirs?.has(s));
    });
  }
}
