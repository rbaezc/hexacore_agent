import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface IFileSystem {
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<void>;
  /** Writes via temp-file-then-rename so readers never observe a partial write. */
  writeFileAtomic(filePath: string, content: string): Promise<void>;
  appendFile(filePath: string, content: string): Promise<void>;
  /** Removes a file or a whole directory tree; missing paths are ignored. */
  remove(targetPath: string): Promise<void>;
  exists(filePath: string): Promise<boolean>;
  ensureDir(dirPath: string): Promise<void>;
  /**
   * Recursively lists files; `ignoreDirs` names (e.g. node_modules) are skipped at any depth and
   * `maxDepth` limits how many directory levels below `dirPath` are descended (unlimited by default).
   */
  listDirectory(dirPath: string, ignoreDirs?: ReadonlySet<string>, maxDepth?: number): Promise<string[]>;
}

export class NodeFileSystem implements IFileSystem {
  async readFile(filePath: string): Promise<string> {
    return await fs.readFile(filePath, 'utf-8');
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
  }

  async writeFileAtomic(filePath: string, content: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).substring(2, 8)}.tmp`;
    try {
      await fs.writeFile(tempPath, content, 'utf-8');
      await fs.rename(tempPath, filePath);
    } catch (error) {
      try {
        await fs.unlink(tempPath);
      } catch {
        // best-effort cleanup; the original error is what matters
      }
      throw error;
    }
  }

  async appendFile(filePath: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, content, 'utf-8');
  }

  async remove(targetPath: string): Promise<void> {
    await fs.rm(targetPath, { force: true, recursive: true });
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async ensureDir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  async listDirectory(dirPath: string, ignoreDirs?: ReadonlySet<string>, maxDepth: number = Infinity): Promise<string[]> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          if (ignoreDirs?.has(entry.name) || maxDepth <= 0) continue;
          const subFiles = await this.listDirectory(fullPath, ignoreDirs, maxDepth - 1);
          files.push(...subFiles);
        } else {
          files.push(fullPath);
        }
      }
      return files;
    } catch {
      return [];
    }
  }
}

/** Build output, dependency caches and VCS dirs no HexaCore scan should ever descend into. */
export const DEFAULT_IGNORED_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  '.hexagen',
  'dist',
  'build',
  'target',
  'vendor',
  'deps',
  '_build',
  '.dart_tool',
  'bin',
  'obj',
  'venv',
  '.venv',
  '__pycache__',
  '.next',
  'coverage',
]);
