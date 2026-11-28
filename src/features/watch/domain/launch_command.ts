/** Built-in ways to open the agent. Anything else containing {command} or {prompt} is a template. */
export const LAUNCHERS = ['wt', 'tmux', 'print'] as const;
export type LauncherName = (typeof LAUNCHERS)[number];

export interface LaunchRequest {
  role: string;
  /** The Claude Code subagent, e.g. hexacore-qa. */
  agentName: string;
  /** Already restricted to a safe alphabet (see dispatchPrompt). */
  prompt: string;
  cwd: string;
}

export interface LaunchCommand {
  cmd: string;
  args: string[];
  /** Templates are the user's own shell line. */
  shell: boolean;
}

export function isTemplate(launcher: string): boolean {
  return /\{(command|prompt|agent|role|cwd)\}/.test(launcher);
}

export function isLauncher(launcher: string): boolean {
  return (LAUNCHERS as readonly string[]).includes(launcher) || isTemplate(launcher);
}

/** The terminal the user is in, when watch runs inside one it can split. */
export function detectLauncher(env: NodeJS.ProcessEnv = process.env): LauncherName {
  if (env.TMUX) return 'tmux';
  if (env.WT_SESSION) return 'wt';
  return 'print';
}

/** What the user would type to start the agent by hand. */
export function agentCommandLine(req: LaunchRequest): string {
  return `claude --agent ${req.agentName} "${req.prompt}"`;
}

/** The process that opens the agent, or undefined for `print`. */
export function buildLaunch(launcher: string, req: LaunchRequest): LaunchCommand | undefined {
  if (launcher === 'print') return undefined;
  if (launcher === 'wt') {
    // PowerShell in a new pane of the current Windows Terminal window. The script is passed
    // encoded: wt splits its own command line on ';', and nothing in it needs quoting that way.
    const script = `$env:HEXACORE_AGENT='${req.role}'\nclaude --agent ${req.agentName} '${req.prompt}'`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    return {
      cmd: 'wt',
      args: ['-w', '0', 'split-pane', '-V', '-d', req.cwd, '--title', req.agentName, 'powershell.exe', '-NoExit', '-EncodedCommand', encoded],
      shell: false,
    };
  }
  if (launcher === 'tmux') {
    return {
      cmd: 'tmux',
      args: ['split-window', '-h', '-c', req.cwd, '-e', `HEXACORE_AGENT=${req.role}`, `claude --agent ${req.agentName} '${req.prompt}'`],
      shell: false,
    };
  }
  if (isTemplate(launcher)) {
    const line = launcher
      .replaceAll('{command}', agentCommandLine(req))
      .replaceAll('{prompt}', req.prompt)
      .replaceAll('{agent}', req.agentName)
      .replaceAll('{role}', req.role)
      .replaceAll('{cwd}', req.cwd);
    return { cmd: line, args: [], shell: true };
  }
  return undefined;
}
