import * as os from 'node:os';
import * as path from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, existsSync, utimesSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquireFileLock } from '../../src/shared/infrastructure/file_lock.js';
import { NodeFileSystem } from '../../src/shared/infrastructure/file_system.js';
import { StateRepository } from '../../src/features/state_management/services/state_repository.js';
import { WorkspaceContext } from '../../src/shared/infrastructure/workspace.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'hexacore-lock-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('acquireFileLock', () => {
  it('lets one holder in at a time and removes the lock on release', async () => {
    const target = path.join(dir, 'state.json');
    const release = await acquireFileLock(target);
    expect(existsSync(`${target}.lock`)).toBe(true);

    let secondIn = false;
    const second = acquireFileLock(target).then((r) => ((secondIn = true), r));
    await new Promise((r) => setTimeout(r, 120));
    expect(secondIn).toBe(false);

    await release();
    const releaseSecond = await second;
    expect(secondIn).toBe(true);
    await releaseSecond();
    expect(existsSync(`${target}.lock`)).toBe(false);
  });

  it('takes over a lock left by a process that no longer exists', async () => {
    const target = path.join(dir, 'state.json');
    writeFileSync(`${target}.lock`, '999999:0:dead');
    const release = await acquireFileLock(target, { timeoutMs: 2000 });
    await release();
    expect(existsSync(`${target}.lock`)).toBe(false);
  });

  it('takes over a lock older than the stale limit', async () => {
    const target = path.join(dir, 'state.json');
    writeFileSync(`${target}.lock`, `${process.pid}:0:hung`);
    const old = new Date(Date.now() - 60_000);
    utimesSync(`${target}.lock`, old, old);
    const release = await acquireFileLock(target, { staleMs: 1000, timeoutMs: 2000 });
    await release();
  });

  it('gives up after the timeout while a live holder keeps the lock', async () => {
    const target = path.join(dir, 'state.json');
    const release = await acquireFileLock(target);
    await expect(acquireFileLock(target, { timeoutMs: 150 })).rejects.toThrow(/Timed out/);
    await release();
  });
});

describe('StateRepository across processes', () => {
  it('keeps every update when two repositories (as two processes would) write at once', async () => {
    const fs = new NodeFileSystem();
    // Separate instances have separate in-process queues, like separate HexaCore processes.
    const a = new StateRepository(fs, new WorkspaceContext(dir));
    const b = new StateRepository(fs, new WorkspaceContext(dir));
    await a.loadState();

    const writes = Array.from({ length: 20 }, (_, i) => [
      a.addFact({ key: `a${i}`, value: String(i), category: 'config' }),
      b.addFact({ key: `b${i}`, value: String(i), category: 'config' }),
    ]).flat();
    const results = await Promise.all(writes);
    expect(results.every((r) => r.isSuccess)).toBe(true);

    const final = await a.loadState();
    expect(final.isSuccess && final.value.facts.length).toBe(40);
    expect(existsSync(path.join(dir, '.hexagen', 'state.json.lock'))).toBe(false);
  });
});
