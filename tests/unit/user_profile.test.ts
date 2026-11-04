import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { createTestHexaCore, TEST_LIBRARY } from '../helpers/test_hexacore.js';
import { createToolRegistry } from '../../src/features/mcp_server/infrastructure/mcp_server_factory.js';
import { InMemoryFileSystem } from '../helpers/in_memory_fs.js';
import { deriveHabits, emptyUsage, looksSensitive, recordEvent } from '../../src/features/user_profile/index.js';

const ctx = { reportProgress: async () => {} };

function setup(options: { fs?: InMemoryFileSystem; root?: string } = {}) {
  const t = createTestHexaCore([0], options);
  const registry = createToolRegistry(t.services);
  const call = async (tool: string, input: Record<string, unknown> = {}): Promise<any> => {
    const res = await registry.call(tool, input, ctx);
    if (res.isFailure) throw res.error;
    return res.value;
  };
  return { ...t, call };
}

describe('user profile', () => {
  it('remembers stated preferences across sessions and projects, and puts them first in the briefing', async () => {
    const shop = setup();
    const pref = await shop.call('remember_preference', { text: 'Always show the plan and wait for approval before writing files.', category: 'workflow' });
    const local = await shop.call('remember_preference', { text: 'Name Go packages in singular.', scope: 'project' });
    // Saying the same thing again doesn't duplicate it.
    await shop.call('remember_preference', { text: 'always show the plan and wait for approval before writing files.' });

    const briefing = (await shop.call('resume_session')).briefing;
    expect(briefing).toContain('How this user works');
    expect(briefing).toContain('- Always show the plan and wait for approval before writing files.');
    expect(briefing).toContain('- Name Go packages in singular. (this project)');

    // Another project on the same machine: the user preference follows, the project one doesn't.
    const blog = setup({ fs: shop.fs, root: path.resolve('/blog') });
    const blogProfile = (await blog.call('resume_session')).profile;
    expect(blogProfile.preferences.map((p: any) => p.text)).toEqual(['Always show the plan and wait for approval before writing files.']);

    await blog.call('remember_preference', { text: 'Show the plan first, then write in small steps.', replaceId: pref.id });
    expect((await shop.call('resume_session')).briefing).toContain('- Show the plan first, then write in small steps.');

    // replaceId finds the preference in whichever scope holds it.
    await shop.call('remember_preference', { text: 'Name Go packages in singular, without underscores.', replaceId: local.id });
    expect((await shop.call('resume_session')).briefing).toContain('- Name Go packages in singular, without underscores. (this project)');

    await blog.call('forget_preference', { id: pref.id });
    expect((await blog.call('resume_session')).profile.preferences).toEqual([]);
  });

  it('refuses to store anything that looks like a credential', async () => {
    const { call } = setup();
    await expect(call('remember_preference', { text: 'Use api_key=sk-live-1234567890abcdef for the staging deploys' })).rejects.toThrow('looks like a credential');
    expect(looksSensitive('Put new slices in src/features/orders/domain/order_entity.ts style paths')).toBe(false);
    expect(looksSensitive('token: ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8')).toBe(true);
  });

  it('learns habits from how HexaCore is actually used, and forgets them on request', async () => {
    const { call, fs } = setup();
    for (let i = 0; i < 5; i++) await call('run_quality_assurance', { stack: 'node', checks: ['typecheck', 'test'] });
    await call('execute_scaffolding', { stack: 'node', sliceName: 'orders', dryRun: true });
    await call('execute_scaffolding', { stack: 'node', sliceName: 'orders' });
    await call('execute_scaffolding', { stack: 'node', sliceName: 'billing', dryRun: true });

    const { profile, briefing } = await call('resume_session');
    expect(profile.habits.map((h: any) => h.id)).toEqual(['stacks', 'qa_checks', 'previews']);
    expect(briefing).toContain('Usually verifies with checks [test, typecheck]: use them by default. (observed)');
    expect(briefing).toContain('Works mostly in node (100%)');

    const stored = JSON.parse(await fs.readFile(path.join(TEST_LIBRARY, 'profile.json')));
    expect(stored.usage.qaCheckSets).toEqual({ 'test,typecheck': 5 });

    await call('forget_preference', { observed: true });
    expect((await call('resume_session')).profile.habits).toEqual([]);
  });

  it('derives habits only from enough evidence', () => {
    const usage = emptyUsage();
    for (let i = 0; i < 4; i++) recordEvent(usage, { tool: 'run_quality_assurance', args: { stack: 'go' }, ok: true });
    recordEvent(usage, { tool: 'run_quality_assurance', args: { stack: 'go' }, ok: false });
    expect(deriveHabits(usage)).toEqual([]);

    for (let i = 0; i < 6; i++) recordEvent(usage, { tool: 'execute_scaffolding', args: { stack: 'go', sliceName: 'x' }, ok: true });
    for (let i = 0; i < 2; i++) recordEvent(usage, { tool: 'rollback_changes', args: { checkpointId: 'cp' }, ok: true });
    const habits = deriveHabits(usage);
    expect(habits.find((h) => h.id === 'rollbacks')?.text).toContain('Rolls back 33%');
    expect(habits.find((h) => h.id === 'previews')).toBeUndefined();
  });
});
