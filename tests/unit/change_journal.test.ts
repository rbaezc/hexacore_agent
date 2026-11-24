import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { ChangeJournal } from '../../src/shared/infrastructure/change_journal.js';
import { WorkspaceContext } from '../../src/shared/infrastructure/workspace.js';
import { InMemoryFileSystem } from '../helpers/in_memory_fs.js';

const ROOT = path.resolve('/ws');
const file = (rel: string) => path.join(ROOT, rel);

function setup() {
  const fs = new InMemoryFileSystem({ [file('a.txt')]: 'original A' });
  return { fs, journal: new ChangeJournal(fs, new WorkspaceContext(ROOT)) };
}

describe('ChangeJournal', () => {
  it('restores modified files and deletes created ones', async () => {
    const { fs, journal } = setup();
    const cp = await journal.begin('test');
    await journal.write(cp, file('a.txt'), 'changed A');
    await journal.write(cp, file('b.txt'), 'new B');
    await journal.write(cp, file('a.txt'), 'changed A twice');

    const res = await journal.rollback(cp.id);
    expect(res.isSuccess && res.value.applied).toBe(true);
    expect(await fs.readFile(file('a.txt'))).toBe('original A');
    expect(await fs.exists(file('b.txt'))).toBe(false);
  });

  it('refuses (changing nothing) when a file was edited after HexaCore wrote it, unless forced', async () => {
    const { fs, journal } = setup();
    const cp = await journal.begin('test');
    await journal.write(cp, file('a.txt'), 'hexacore A');
    await journal.write(cp, file('b.txt'), 'hexacore B');
    await fs.writeFile(file('a.txt'), 'developer edit');

    const refused = await journal.rollback(cp.id);
    expect(refused.isSuccess).toBe(true);
    if (refused.isSuccess) {
      expect(refused.value.applied).toBe(false);
      expect(refused.value.conflicts).toEqual(['a.txt']);
    }
    expect(await fs.readFile(file('b.txt'))).toBe('hexacore B');

    const forced = await journal.rollback(cp.id, true);
    expect(forced.isSuccess && forced.value.applied).toBe(true);
    expect(await fs.readFile(file('a.txt'))).toBe('original A');
  });

  it('removes the directories it created once they are empty, and only those', async () => {
    const { fs, journal } = setup();
    await fs.writeFile(file('src/main.ts'), 'existing');
    const cp = await journal.begin('scaffold');
    await journal.write(cp, file('src/features/refunds/domain/entity.ts'), 'e');
    await journal.write(cp, file('src/features/refunds/tests/entity.test.ts'), 't');

    const res = await journal.rollback(cp.id);
    expect(res.isSuccess && res.value.applied).toBe(true);
    if (res.isSuccess) {
      expect(res.value.removedDirs).toEqual(['src/features/refunds/domain', 'src/features/refunds/tests', 'src/features/refunds', 'src/features']);
    }
    expect(await fs.exists(file('src/features'))).toBe(false);
    expect(await fs.exists(file('src'))).toBe(true);
    expect(await fs.readFile(file('src/main.ts'))).toBe('existing');
  });

  it('keeps a created directory that holds something it did not write', async () => {
    const { fs, journal } = setup();
    const cp = await journal.begin('scaffold');
    await journal.write(cp, file('src/features/refunds/index.ts'), 'i');
    await fs.writeFile(file('src/features/refunds/notes.md'), 'developer notes');

    const res = await journal.rollback(cp.id);
    expect(res.isSuccess && res.value.applied).toBe(true);
    if (res.isSuccess) expect(res.value.removedDirs).toEqual([]);
    expect(await fs.exists(file('src/features/refunds/index.ts'))).toBe(false);
    expect(await fs.readFile(file('src/features/refunds/notes.md'))).toBe('developer notes');
  });

  it('rolls back journals written before directories were recorded', async () => {
    const { fs, journal } = setup();
    const cp = await journal.begin('old');
    await journal.write(cp, file('lib/x.ts'), 'x');
    const stored = JSON.parse(await fs.readFile(file(`.hexagen/checkpoints/${cp.id}.json`)));
    delete stored.createdDirs;
    await fs.writeFile(file(`.hexagen/checkpoints/${cp.id}.json`), JSON.stringify(stored));

    const res = await journal.rollback(cp.id);
    expect(res.isSuccess && res.value.applied).toBe(true);
    if (res.isSuccess) expect(res.value.removedDirs).toEqual([]);
    expect(await fs.exists(file('lib/x.ts'))).toBe(false);
  });

  it('never writes outside the workspace', async () => {
    const { journal } = setup();
    const cp = await journal.begin('test');
    const res = await journal.write(cp, path.resolve('/elsewhere/x.txt'), 'nope');
    expect(res.isFailure).toBe(true);
  });

  it('lists checkpoints newest first and rejects a second rollback', async () => {
    const { journal } = setup();
    const first = await journal.begin('first');
    await new Promise((r) => setTimeout(r, 2));
    await journal.begin('second');
    expect((await journal.list()).map((c) => c.label)).toEqual(['second', 'first']);

    await journal.rollback(first.id);
    expect((await journal.rollback(first.id)).isFailure).toBe(true);
  });
});
