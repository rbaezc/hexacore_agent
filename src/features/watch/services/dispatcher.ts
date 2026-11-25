import { spawn } from 'node:child_process';
import { Result, ok, fail } from '../../../shared/domain/result.js';
import { DispatchPolicy, DispatchRole } from '../domain/dispatch_policy.js';
import { DispatchHandoff, dispatchHandoff, dispatchPrompt } from '../domain/dispatch_text.js';
import { LAUNCHERS, LaunchCommand, LaunchRequest, agentCommandLine, buildLaunch } from '../domain/launch_command.js';
import { Transition } from '../domain/watch_types.js';

export type ProcessLauncher = (command: LaunchCommand, cwd: string, env: Record<string, string>) => Promise<Result<void, Error>>;

/** Starts the terminal command detached: the agent outlives watch mode and belongs to the user. */
export const spawnDetached: ProcessLauncher = (command, cwd, env) =>
  new Promise((resolve) => {
    try {
      const child = spawn(command.cmd, command.args, { cwd, env: { ...process.env, ...env }, shell: command.shell, detached: true, stdio: 'ignore' });
      child.once('error', (error) => resolve(fail(error)));
      child.once('spawn', () => {
        child.unref();
        resolve(ok(undefined));
      });
    } catch (error: any) {
      resolve(fail(error instanceof Error ? error : new Error(String(error))));
    }
  });

export interface DispatcherDeps {
  policy: DispatchPolicy;
  role: DispatchRole;
  /** wt, tmux, print or a command template (see buildLaunch). */
  launcher: string;
  cwd: string;
  /** Saves the handoff from 'watch' to the role, before the agent starts. */
  recordHandoff: (note: DispatchHandoff) => Promise<void>;
  /** Whether the role recorded a handoff after the given time (the agent reported back). */
  reportedSince: (role: string, sinceIso: string) => Promise<boolean>;
  launch?: ProcessLauncher;
  now?: () => number;
  log: (line: string) => void;
}

/** Runs after every watch run: may start one agent for the checks that just turned red. */
export class Dispatcher {
  constructor(private readonly deps: DispatcherDeps) {}

  async afterRun(transitions: Transition[]): Promise<void> {
    const { policy, role, log } = this.deps;
    const now = (this.deps.now ?? Date.now)();

    for (const d of [...policy.active]) {
      if (await this.deps.reportedSince(role, new Date(d.at).toISOString())) {
        const line = policy.release(d.id, 'reported back with a handoff');
        if (line) log(`⇢ ${line}`);
      }
    }

    const plan = policy.plan(transitions, now);
    for (const line of plan.released) log(`⇢ ${line}`);
    for (const line of plan.skipped) log(`⇢ no ${role} agent for ${line}`);
    if (!plan.dispatch) return;

    const d = plan.dispatch;
    await this.deps.recordHandoff(dispatchHandoff(d));
    const req: LaunchRequest = { role, agentName: `hexacore-${role}`, prompt: dispatchPrompt(d, role), cwd: this.deps.cwd };
    const command = buildLaunch(this.deps.launcher, req);
    if (!command) {
      log(`⇢ ${d.keys.join(', ')} broke; handoff left for ${role}. Start the agent with: ${agentCommandLine(req)}`);
      return;
    }
    const via = (LAUNCHERS as readonly string[]).includes(this.deps.launcher) ? this.deps.launcher : 'your launcher template';
    const started = await (this.deps.launch ?? spawnDetached)(command, this.deps.cwd, { HEXACORE_AGENT: role });
    if (started.isFailure) {
      log(`! could not open the ${role} agent with ${via} (${started.error.message}). Start it with: ${agentCommandLine(req)}`);
      return;
    }
    log(`⇢ agent #${d.id} (${req.agentName}) started for ${d.keys.join(', ')} with ${via}`);
  }
}
