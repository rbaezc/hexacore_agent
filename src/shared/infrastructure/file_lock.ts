import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** A holder that hasn't released after this long crashed or hung; its lock may be taken over. */
const STALE_MS = 15_000;
const TIMEOUT_MS = 20_000;

export interface FileLockOptions {
  staleMs?: number;
  timeoutMs?: number;
}

/**
 * Cross-process lock for a read-modify-write of `filePath`: `<filePath>.lock`, created exclusively.
 * A lock whose owner process is gone, or that is older than `staleMs`, is taken over.
 * Resolves to the release function; release only removes the lock if it is still ours.
 */
const BUSY_CODES = new Set(['EEXIST', 'EPERM', 'EACCES', 'EBUSY']);

export async function acquireFileLock(filePath: string, options: FileLockOptions = {}): Promise<() => Promise<void>> {
  const lockPath = `${filePath}.lock`;
  const staleMs = options.staleMs ?? STALE_MS;
  const deadline = Date.now() + (options.timeoutMs ?? TIMEOUT_MS);
  const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
  await fs.mkdir(path.dirname(lockPath), { recursive: true });

  let lastCode = 'EEXIST';
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.writeFile(lockPath, token, { flag: 'wx' });
      return async () => {
        try {
          if ((await fs.readFile(lockPath, 'utf-8')) === token) await fs.unlink(lockPath);
        } catch {
          // already gone or taken over: nothing of ours to remove
        }
      };
    } catch (error: any) {
      // Windows answers EPERM/EACCES/EBUSY (not EEXIST) while another holder's lock file is being deleted: busy, retry.
      if (!BUSY_CODES.has(error?.code)) throw error;
      lastCode = error.code;
    }
    const stale = lastCode === 'EEXIST' ? await staleContent(lockPath, staleMs) : null;
    if (stale !== null) {
      // Only remove the lock we judged stale, not one another process took over meanwhile.
      if ((await fs.readFile(lockPath, 'utf-8').catch(() => null)) === stale) await fs.unlink(lockPath).catch(() => undefined);
      continue;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${lockPath} (${lastCode}); remove it if no HexaCore process is running.`);
    }
    await new Promise((r) => setTimeout(r, Math.min(200, 10 + attempt * 5) + Math.random() * 20));
  }
}

/** The lock's content when it is stale, else null. */
async function staleContent(lockPath: string, staleMs: number): Promise<string | null> {
  try {
    const [content, info] = await Promise.all([fs.readFile(lockPath, 'utf-8'), fs.stat(lockPath)]);
    if (Date.now() - info.mtimeMs > staleMs) return content;
    const pid = Number(content.split(':')[0]);
    return Number.isInteger(pid) && pid > 0 && pid !== process.pid && !isAlive(pid) ? content : null;
  } catch {
    return null; // released meanwhile (or unreadable for a moment): just retry
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code === 'EPERM'; // exists, owned by someone else
  }
}
