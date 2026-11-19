import { Transition, WatchedResult, WatchedStatus } from './watch_types.js';

export const keyOf = (r: Pick<WatchedResult, 'stack' | 'check'>): string => `${r.stack}:${r.check}`;

/**
 * Compares a run with the last known status of each check.
 * Skipped checks never produce a transition and never overwrite a known status:
 * a tool that is missing for one run says nothing about the code.
 */
export function compareRuns(previous: ReadonlyMap<string, WatchedStatus>, results: WatchedResult[]): Transition[] {
  const transitions: Transition[] = [];
  for (const result of results) {
    if (result.status === 'skipped') continue;
    const before = previous.get(keyOf(result));
    if (before === undefined) {
      transitions.push({ kind: result.status === 'failed' ? 'baseline_failing' : 'baseline_ok', result });
    } else if (before === 'passed' && result.status === 'failed') {
      transitions.push({ kind: 'broke', result, previous: before });
    } else if (before === 'failed' && result.status === 'passed') {
      transitions.push({ kind: 'fixed', result, previous: before });
    } else if (result.status === 'failed') {
      transitions.push({ kind: 'still_failing', result, previous: before });
    }
  }
  return transitions;
}

/** The statuses to remember after a run (skipped checks keep their previous status). */
export function nextStatuses(previous: ReadonlyMap<string, WatchedStatus>, results: WatchedResult[]): Map<string, WatchedStatus> {
  const next = new Map(previous);
  for (const r of results) if (r.status !== 'skipped') next.set(keyOf(r), r.status);
  return next;
}

/** One line per run for the terminal, e.g. "✓ typecheck · ✗ test 2 failing". */
export function summarizeRun(results: WatchedResult[], multiStack: boolean): string {
  return results
    .map((r) => {
      const name = multiStack ? `${r.stack}/${r.check}` : r.check;
      if (r.status === 'skipped') return `– ${name} skipped`;
      return r.status === 'passed' ? `✓ ${name}` : `✗ ${name} ${r.failed} failing`;
    })
    .join(' · ');
}
