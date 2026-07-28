import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Result, ok, fail } from '../../../shared/domain/result.js';

export class AtomicFileWriter {
  static async writeAtomic(targetFilePath: string, content: string): Promise<Result<void, Error>> {
    const tempPath = `${targetFilePath}.${Date.now()}.${Math.random().toString(36).substring(2, 8)}.tmp`;
    try {
      const dir = path.dirname(targetFilePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(tempPath, content, 'utf-8');
      await fs.rename(tempPath, targetFilePath);
      return ok(undefined);
    } catch (error: any) {
      try {
        await fs.unlink(tempPath);
      } catch {}
      return fail(new Error(`Atomic write failed for '${targetFilePath}': ${error.message}`));
    }
  }
}
