import { AsyncLocalStorage } from 'node:async_hooks';

/** Agent names are stored in state and shown in feeds: short, plain identifiers only. */
const VALID_AGENT = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

const storage = new AsyncLocalStorage<{ agent?: string }>();

export function isValidAgentName(name: string): boolean {
  return VALID_AGENT.test(name);
}

/** Runs `fn` on behalf of `agent` (a role such as "qa"); everything it records is attributed to it. */
export function runAsAgent<T>(agent: string | undefined, fn: () => Promise<T>): Promise<T> {
  return storage.run({ agent }, fn);
}

/**
 * The agent the current work is attributed to: the one a tool call named, else HEXACORE_AGENT
 * (set for a whole process, e.g. one terminal pane per agent), else none.
 */
export function currentAgent(): string | undefined {
  const named = storage.getStore()?.agent;
  if (named) return named;
  const env = process.env.HEXACORE_AGENT?.trim();
  return env && isValidAgentName(env) ? env : undefined;
}
