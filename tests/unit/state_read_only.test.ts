import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { StateRepository } from '../../src/features/state_management/services/state_repository.js';
import { WorkspaceContext } from '../../src/shared/infrastructure/workspace.js';
import { InMemoryFileSystem } from '../helpers/in_memory_fs.js';

const ROOT = path.resolve('/ws');

describe('StateRepository reads', () => {
  it('do not create .hexagen/ in a project that has none; the first write does', async () => {
    const fs = new InMemoryFileSystem();
    const repo = new StateRepository(fs, new WorkspaceContext(ROOT));
    const manifest = path.join(ROOT, '.hexagen', 'state.json');

    const state = await repo.loadState();
    expect(state.isSuccess && state.value.handoffs).toEqual([]);
    expect(await fs.exists(manifest)).toBe(false);

    await repo.addHandoff({ id: 'handoff_1', summary: 'first', nextSteps: [], openQuestions: [], createdAt: new Date().toISOString() });
    expect(await fs.exists(manifest)).toBe(true);
  });
});
