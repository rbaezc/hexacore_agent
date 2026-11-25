import { Dispatch } from './dispatch_policy.js';
import { WatchedResult } from './watch_types.js';

export interface DispatchHandoff {
  summary: string;
  nextSteps: string[];
  openQuestions: string[];
}

const MAX_FAILURES = 5;
const firstLine = (text: string, max = 200) => {
  const line = text.split(/\r?\n/).find((l) => l.trim())?.trim() ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};
const name = (r: WatchedResult) => `${r.stack}/${r.check}`;

/** What the dispatched agent reads first (through resume_session): what broke and where. */
export function dispatchHandoff(d: Dispatch): DispatchHandoff {
  const results = d.transitions.map((t) => t.result);
  const checks = results.map((r) => `${name(r)} (${r.failed || 'some'} failing)`).join(', ');
  const failures = results
    .flatMap((r) => r.failures.map((f) => ({ r, f })))
    .slice(0, MAX_FAILURES)
    .map(({ r, f }) => {
      const where = f.file ? `${f.file}${f.line ? `:${f.line}` : ''} ` : '';
      const test = f.testName ? `"${f.testName}" ` : '';
      return `${name(r)}: ${where}${test}${where || test ? '— ' : ''}${firstLine(f.errorMessage)}`;
    });
  return {
    summary: `Watch mode: ${checks}. Over to qa.`,
    nextSteps: [
      ...failures,
      `Re-run run_quality_assurance with checks ${[...new Set(results.map((r) => r.check))].join(', ')}, fix the cause, then record_handoff to dev with what you changed.`,
    ],
    openQuestions: [],
  };
}

/**
 * The prompt typed into the new agent. Kept short and to a safe alphabet, because it travels
 * through terminal command lines; the details live in the handoff.
 */
export function dispatchPrompt(d: Dispatch, role: string): string {
  const checks = d.transitions.map((t) => name(t.result)).join(', ');
  const text = `Watch mode found failing checks: ${checks}. Call resume_session with agent ${role}, read the handoff from watch, fix the failures and record a handoff when done.`;
  return text.replace(/[^A-Za-z0-9 ,./:_-]/g, '');
}
