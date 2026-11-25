import { Transition } from './watch_types.js';
import { keyOf } from './transitions.js';

/** Roles watch mode may start on its own (e2e comes later, for UI checks). */
export const DISPATCH_ROLES = ['qa'] as const;
export type DispatchRole = (typeof DISPATCH_ROLES)[number];

/** No watch session starts more agents than this, whatever the flags say. */
export const SESSION_DISPATCH_CAP = 5;

export interface DispatchOptions {
  /** Dispatched agents allowed in flight at once. */
  maxAgents: number;
  /** How long a dispatched agent counts as working before watch gives up on it. */
  cooldownMs: number;
  sessionCap?: number;
}

/** One agent started for one or more checks that broke in the same run. */
export interface Dispatch {
  id: number;
  /** stack:check keys the agent was started for and that are still red. */
  keys: string[];
  at: number;
  transitions: Transition[];
}

export interface DispatchPlan {
  dispatch?: Dispatch;
  /** Why a failing check did not get an agent (for the log). */
  skipped: string[];
  /** Agents that stopped counting as in flight (for the log). */
  released: string[];
}

/**
 * Decides when watch mode starts an agent. Pure: no clock, no processes.
 * An agent fixing code makes watch re-run, so the rules are about not starting agents in a loop:
 * only checks that just turned red count, one agent per check, a cap on agents in flight, a
 * cooldown, a per-session cap, and a check whose agent timed out waits until it passes once.
 */
export class DispatchPolicy {
  private inFlight: Dispatch[] = [];
  private blocked = new Set<string>();
  private count = 0;

  constructor(private readonly opts: DispatchOptions) {}

  get active(): readonly Dispatch[] {
    return this.inFlight;
  }

  /** The agent reported back (it recorded a handoff), so it is no longer in flight. */
  release(id: number, reason: string): string | undefined {
    const index = this.inFlight.findIndex((d) => d.id === id);
    if (index < 0) return undefined;
    this.inFlight.splice(index, 1);
    return `agent #${id} ${reason}`;
  }

  plan(transitions: Transition[], now: number): DispatchPlan {
    const released: string[] = [];
    const green = new Set(transitions.filter((t) => t.result.status === 'passed').map((t) => keyOf(t.result)));
    for (const key of green) this.blocked.delete(key);

    for (const d of [...this.inFlight]) {
      d.keys = d.keys.filter((k) => !green.has(k));
      if (d.keys.length === 0) {
        this.drop(d);
        released.push(`agent #${d.id} done: its checks pass again`);
      } else if (now - d.at >= this.opts.cooldownMs) {
        this.drop(d);
        for (const k of d.keys) this.blocked.add(k);
        released.push(`agent #${d.id} timed out on ${d.keys.join(', ')}; no new agent for them until they pass once`);
      }
    }

    const skipped: string[] = [];
    const busy = new Set(this.inFlight.flatMap((d) => d.keys));
    const fresh = transitions.filter((t) => {
      if (t.kind !== 'broke' && t.kind !== 'baseline_failing') return false;
      const key = keyOf(t.result);
      if (busy.has(key)) skipped.push(`${key}: an agent is already on it`);
      else if (this.blocked.has(key)) skipped.push(`${key}: the last agent timed out; waiting for it to pass once`);
      else return true;
      return false;
    });
    if (fresh.length === 0) return { skipped, released };

    const keys = fresh.map((t) => keyOf(t.result));
    const cap = this.opts.sessionCap ?? SESSION_DISPATCH_CAP;
    if (this.inFlight.length >= this.opts.maxAgents) {
      skipped.push(`${keys.join(', ')}: ${this.inFlight.length} agent(s) already running (maxAgents ${this.opts.maxAgents})`);
      return { skipped, released };
    }
    if (this.count >= cap) {
      skipped.push(`${keys.join(', ')}: this watch session already started ${cap} agents`);
      return { skipped, released };
    }
    const dispatch: Dispatch = { id: ++this.count, keys, at: now, transitions: fresh };
    this.inFlight.push(dispatch);
    return { dispatch, skipped, released };
  }

  private drop(d: Dispatch): void {
    this.inFlight = this.inFlight.filter((x) => x !== d);
  }
}

/** "10m", "90s", "1h" or plain milliseconds. */
export function parseDuration(value: string): number | undefined {
  const m = value.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/);
  if (!m) return undefined;
  const unit = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[(m[2] ?? 'ms') as 'ms' | 's' | 'm' | 'h'];
  return Math.round(Number(m[1]) * unit);
}
