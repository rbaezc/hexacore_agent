import { describe, expect, it } from 'vitest';
import { collectActivity } from '../../src/features/state_management/index.js';
import { formatEvent } from '../../src/cli/activity_command.js';
import type { Checkpoint } from '../../src/shared/domain/checkpoint.js';

const state: any = {
  metadata: { projectName: 'shop', activeStacks: ['node'], version: '1', lastUpdated: '' },
  facts: [],
  ledger: [],
  plans: [],
  decisions: [],
  qaHistory: [
    { stack: 'node', check: 'test', status: 'failed', failed: 2, total: 5, at: '2026-11-24T10:02:00.000Z', agent: 'qa' },
    { stack: 'node', check: 'test', status: 'passed', failed: 0, total: 5, at: '2026-11-24T10:04:00.000Z', source: 'watch' },
  ],
  handoffs: [{ id: 'handoff_1', summary: 'refunds ready', nextSteps: [], openQuestions: [], createdAt: '2026-11-24T10:01:00.000Z', from: 'dev', to: 'qa' }],
};
const change = { path: '/ws/a.ts', original: null, written: 'x' };
const checkpoints: Checkpoint[] = [
  { id: 'cp_1', label: "scaffold node slice 'refunds'", createdAt: '2026-11-24T10:00:00.000Z', status: 'rolled_back', changes: [change, change], agent: 'dev', rolledBackAt: '2026-11-24T10:03:00.000Z', rolledBackBy: 'qa' },
  { id: 'cp_2', label: 'empty', createdAt: '2026-11-24T10:00:30.000Z', status: 'open', changes: [] },
];

describe('activity feed', () => {
  it('merges writes, handoffs, QA runs and rollbacks in time order, with who did each', () => {
    const events = collectActivity(state, checkpoints);
    expect(events.map((e) => `${e.agent} ${e.kind} ${e.text}`)).toEqual([
      "dev write scaffold node slice 'refunds' (2 files)",
      'dev handoff → qa: refunds ready',
      'qa qa node/test: 2 failing',
      "qa rollback rolled back: scaffold node slice 'refunds'",
      'watch qa node/test: 5 passing',
    ]);
    expect(new Set(events.map((e) => e.key)).size).toBe(events.length);
  });

  it('formats a line with the agent and a pass/fail mark', () => {
    const [, , red] = collectActivity(state, checkpoints);
    const line = formatEvent(red, false);
    expect(line).toMatch(/qa {5}✗ node\/test: 2 failing$/);
    expect(formatEvent(red, true)).toContain('\x1b[');
  });

  it('marks a skipped check as neither passed nor failed', () => {
    const skipped = { ...state, qaHistory: [{ stack: 'node', check: 'lint', status: 'skipped', failed: 0, total: 0, at: '2026-11-24T10:05:00.000Z', agent: 'qa' }], handoffs: [] };
    const [event] = collectActivity(skipped, []);
    expect(event.ok).toBeUndefined();
    expect(formatEvent(event, false)).toMatch(/qa {5}– node\/lint: skipped$/);
  });
});
