import { spawn } from 'node:child_process';

/** Opens a URL in the default browser without a shell interpreting it. */
export function openInBrowser(url: string): void {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(cmd, args as string[], { stdio: 'ignore', detached: true }).unref();
  } catch {
    // Opening a browser is a convenience; the URL is printed anyway.
  }
}
