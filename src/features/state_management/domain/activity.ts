import { StateManifest } from './state_types.js';
import { Checkpoint } from '../../../shared/domain/checkpoint.js';

/** One line of the shared activity feed: who did what, and when. */
export interface ActivityEvent {
  /** Stable across polls, so a feed prints each event once. */
  key: string;
  at: string;
  /** The agent (role) that did it; 'watch' for watch mode, '-' when unknown. */
  agent: string;
  kind: 'write' | 'rollback' | 'qa' | 'handoff';
  text: string;
  /** For qa: whether the check passed; absent when it was skipped. */
  ok?: boolean;
}

/** Everything the agents left in the project's state and checkpoints, oldest first. */
export function collectActivity(state: StateManifest, checkpoints: Checkpoint[]): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (const cp of checkpoints) {
    if (cp.changes.length === 0) continue; // begun but nothing written
    const files = `${cp.changes.length} file${cp.changes.length === 1 ? '' : 's'}`;
    events.push({ key: `cp:${cp.id}`, at: cp.createdAt, agent: cp.agent ?? '-', kind: 'write', text: `${cp.label} (${files})` });
    if (cp.status === 'rolled_back') {
      events.push({ key: `rb:${cp.id}`, at: cp.rolledBackAt ?? cp.createdAt, agent: cp.rolledBackBy ?? cp.agent ?? '-', kind: 'rollback', text: `rolled back: ${cp.label}` });
    }
  }
  for (const q of state.qaHistory) {
    const result = q.status === 'passed' ? (q.total ? `${q.total} passing` : 'passed') : q.status === 'failed' ? `${q.failed} failing` : 'skipped';
    events.push({
      key: `qa:${q.at}:${q.stack}:${q.check}`,
      at: q.at,
      agent: q.agent ?? (q.source === 'watch' ? 'watch' : '-'),
      kind: 'qa',
      text: `${q.stack}/${q.check}: ${result}`,
      // Skipped (tool not configured) is neither a pass nor a failure.
      ...(q.status === 'skipped' ? {} : { ok: q.status === 'passed' }),
    });
  }
  for (const h of state.handoffs) {
    events.push({ key: `ho:${h.id}`, at: h.createdAt, agent: h.from ?? '-', kind: 'handoff', text: `${h.to ? `→ ${h.to}: ` : 'handoff: '}${h.summary}` });
  }
  return events.sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key));
}
