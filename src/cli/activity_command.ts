import { createHexaCore, HexaCoreServices } from '../composition_root.js';
import { ActivityEvent, collectActivity } from '../features/state_management/index.js';

type Flags = Record<string, string | boolean>;

const ROLE_COLORS: Record<string, string> = { dev: '36', qa: '35', e2e: '33', watch: '90' };
const ICONS: Record<ActivityEvent['kind'], string> = { write: '✎', rollback: '↶', qa: '', handoff: '⇄' };

function paint(text: string, code: string, color: boolean): string {
  return color ? `\x1b[${code}m${text}\x1b[0m` : text;
}

/** One feed line: time, agent, icon and what happened. */
export function formatEvent(e: ActivityEvent, color: boolean): string {
  const time = new Date(e.at).toLocaleTimeString();
  const agent = paint(e.agent.padEnd(6), ROLE_COLORS[e.agent] ?? '37', color);
  const icon = e.kind === 'qa' ? (e.ok ? paint('✓', '32', color) : paint('✗', '31', color)) : ICONS[e.kind];
  const text = e.kind === 'rollback' ? paint(e.text, '33', color) : e.text;
  return `${paint(time, '90', color)}  ${agent} ${icon} ${text}`;
}

async function snapshot(services: HexaCoreServices): Promise<ActivityEvent[]> {
  const state = await services.stateRepo.loadState();
  if (state.isFailure) throw state.error;
  return collectActivity(state.value, await services.journal.list(200));
}

/**
 * `hexacore activity`: a live feed of what every agent (and watch mode) did in this workspace —
 * writes, rollbacks, QA runs and handoffs — meant for a side pane next to the agents.
 */
export async function runActivity(workspaceRoot: string | undefined, flags: Flags, write: (line: string) => void = (l) => console.log(l)): Promise<number> {
  const services = createHexaCore({ workspaceRoot, telemetryLog: false, preview: false });
  const color = flags.color === true || (flags.color !== false && flags.noColor !== true && Boolean(process.stdout.isTTY));
  const last = typeof flags.last === 'string' ? Math.max(0, Number(flags.last) || 0) : 20;
  const interval = typeof flags.interval === 'string' ? Math.max(200, Number(flags.interval) || 1000) : 1000;

  const seen = new Set<string>();
  const initial = await snapshot(services);
  initial.forEach((e) => seen.add(e.key));
  if (initial.length > last) write(paint(`… ${initial.length - last} earlier event(s)`, '90', color));
  for (const e of initial.slice(-last)) write(formatEvent(e, color));
  if (flags.once === true) return 0;

  console.error(`Following ${services.workspace.root} (Ctrl+C to stop).`);
  return new Promise<number>((resolve) => {
    const timer = setInterval(async () => {
      try {
        for (const e of await snapshot(services)) {
          if (seen.has(e.key)) continue;
          seen.add(e.key);
          write(formatEvent(e, color));
        }
      } catch {
        // state being rewritten by another agent: next tick
      }
    }, interval);
    process.once('SIGINT', () => {
      clearInterval(timer);
      resolve(0);
    });
  });
}
