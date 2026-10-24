import { ArchitectureRole, SourceLanguage, SourceLocation } from '../domain/architecture_types.js';

const EXTENSIONS: Record<string, SourceLanguage> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'typescript',
  '.jsx': 'typescript',
  '.mjs': 'typescript',
  '.cjs': 'typescript',
  '.dart': 'dart',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.cs': 'csharp',
  '.php': 'php',
  '.rb': 'ruby',
  '.ex': 'elixir',
  '.exs': 'elixir',
};

export function languageOf(relPath: string): SourceLanguage | undefined {
  const ext = relPath.slice(relPath.lastIndexOf('.')).toLowerCase();
  return EXTENSIONS[ext];
}

export function normalizeSlice(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const LAYER_DIRS: Record<string, ArchitectureRole> = {
  domain: 'domain',
  application: 'application',
  infrastructure: 'infrastructure',
  presentation: 'presentation',
  tests: 'test',
  test: 'test',
  __tests__: 'test',
};

/** File-per-layer layouts (Rust, Python, Go generated slices). */
const LAYER_FILES: Record<string, ArchitectureRole> = {
  domain: 'domain',
  service: 'application',
  repository: 'infrastructure',
  handler: 'presentation',
  router: 'presentation',
  module: 'module',
  mod: 'module',
  __init__: 'module',
};

/**
 * Maps a workspace-relative path (forward slashes) to its slice and layer, following the
 * layouts HexaCore generates per stack. Returns undefined for files outside any slice.
 * Elixir paths need the OTP app name, so they're classified by the checker instead.
 */
export function classifyPath(relPath: string): SourceLocation | undefined {
  const p = relPath.replace(/\\/g, '/');

  // TS/JS/Dart: (src|lib)/features/<slice>/<layer>/...  — Ruby/Laravel: app/(features|Features)/<slice>/<layer>/...
  let m = p.match(/(?:^|\/)(?:src|lib|app)\/[Ff]eatures\/([^/]+)\/(.+)$/);
  if (m) return { slice: normalizeSlice(m[1]), role: roleFromRest(m[2]) };

  // .NET: Features/<Slice>/<Layer>/... (namespaced project folders)
  m = p.match(/(?:^|\/)Features\/([^/]+)\/(.+)$/);
  if (m) return { slice: normalizeSlice(m[1]), role: roleFromRest(m[2]) };

  // Rust / Python / Go: <root>/slices/<slice>/<file>
  m = p.match(/(?:^|\/)(?:src|app|internal)\/slices\/([^/]+)\/(.+)$/);
  if (m) {
    const rest = m[2];
    if (/(^|\/)tests?\//.test(rest) || /_test\.go$/.test(rest)) return { slice: normalizeSlice(m[1]), role: 'test' };
    const stem = rest.split('/').pop()!.replace(/\.\w+$/, '');
    return { slice: normalizeSlice(m[1]), role: LAYER_FILES[stem] ?? 'unknown' };
  }
  return undefined;
}

function roleFromRest(rest: string): ArchitectureRole {
  const segments = rest.split('/');
  if (segments.length === 1) return /[._-](test|spec)\.|Tests?\.cs$|_spec\.rb$/.test(rest) ? 'test' : 'module';
  return LAYER_DIRS[segments[0].toLowerCase()] ?? 'unknown';
}

/** Tests live outside the slice tree in several stacks (tests/, spec/, test/): exempt them from layer rules. */
export function isOutOfTreeTest(relPath: string): boolean {
  return /(^|\/)(tests?|spec)\//.test(relPath.replace(/\\/g, '/'));
}
