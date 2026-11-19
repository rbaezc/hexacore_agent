/** Directories that never hold code worth re-checking (dependencies, build output, tool state). */
const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'target',
  'bin',
  'obj',
  'venv',
  '__pycache__',
  'vendor',
  '_build',
  'deps',
]);

const IGNORED_SUFFIXES = ['.log', '.tsbuildinfo', '.tmp', '.swp', '.swo', '~', '.pyc'];

/**
 * Decides which changed paths should trigger a run. Besides the built-in list it honours the
 * simple entries of the root .gitignore: plain names ("tmp", "/reports/") and "*.ext".
 * Every dot-directory (.git, .hexagen, .venv, .idea…) is ignored too.
 */
export function createIgnorePolicy(gitignore = ''): (relPath: string) => boolean {
  const names = new Set(IGNORED_DIRS);
  const suffixes = [...IGNORED_SUFFIXES];
  for (const raw of gitignore.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const entry = line.replace(/^\//, '').replace(/\/$/, '');
    if (/^\*\.[\w.-]+$/.test(entry)) suffixes.push(entry.slice(1));
    else if (/^[\w.-]+$/.test(entry)) names.add(entry);
  }
  return (relPath: string) => {
    const segments = relPath.split(/[\\/]/).filter(Boolean);
    if (segments.length === 0) return true;
    if (segments.some((s) => s.startsWith('.') || names.has(s))) return true;
    const file = segments[segments.length - 1];
    return suffixes.some((s) => file.endsWith(s));
  };
}
