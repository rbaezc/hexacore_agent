import * as path from 'node:path';
import { ArchitectureRole, ImportReference, SourceLanguage } from '../domain/architecture_types.js';
import { classifyPath, normalizeSlice } from './source_classifier.js';

export interface ExtractionContext {
  /** Workspace-relative path of the file being analysed (forward slashes). */
  relPath: string;
  language: SourceLanguage;
  /** Dart package name → `package:<name>/` maps to lib/. */
  dartPackage?: string;
  /** Elixir root module (MyApp) for alias resolution. */
  elixirModule?: string;
  /** Normalized names of every slice found in the scan (for namespace-based languages). */
  knownSlices: ReadonlySet<string>;
}

const NAMESPACE_LAYERS: Record<string, ArchitectureRole> = {
  domain: 'domain',
  application: 'application',
  infrastructure: 'infrastructure',
  presentation: 'presentation',
  composition: 'module',
};

/** Extracts the imports of a file that resolve to a known slice location. */
export function extractImports(content: string, ctx: ExtractionContext): ImportReference[] {
  const refs: ImportReference[] = [];
  const lines = content.split(/\r?\n/);
  const dir = path.posix.dirname(ctx.relPath);

  const fromPath = (line: number, specifier: string, targetPath: string) => {
    const target = classifyPath(path.posix.normalize(targetPath));
    if (target) refs.push({ line, specifier, target });
  };
  const fromNamespace = (line: number, specifier: string, slice: string, layer?: string) => {
    const normalized = normalizeSlice(slice);
    if (!ctx.knownSlices.has(normalized)) return;
    // No layer segment = the slice's root namespace (its public module); an unrecognised one = internal code.
    const role = layer === undefined ? 'module' : (NAMESPACE_LAYERS[layer.toLowerCase()] ?? 'unknown');
    refs.push({ line, specifier, target: { slice: normalized, role } });
  };

  let inRustTests = false;
  lines.forEach((text, index) => {
    const line = index + 1;
    // A file declaring its own module/namespace is not a dependency on it.
    if (/^\s*(namespace|defmodule)\b/.test(text)) return;
    // Rust unit tests live in a nested `mod tests` (where `super` means something else); tests are exempt anyway.
    if (ctx.language === 'rust' && /^\s*#\[cfg\(test\)\]/.test(text)) inRustTests = true;
    if (inRustTests) return;
    switch (ctx.language) {
      case 'typescript':
        for (const m of text.matchAll(/(?:from\s*|import\s*\(?\s*|require\(\s*)['"]([^'"]+)['"]/g)) {
          const spec = m[1];
          // Code generators carry other languages' imports inside template strings; those aren't dependencies.
          if (spec.includes('${') || spec.startsWith('package:')) continue;
          if (spec.startsWith('.')) fromPath(line, spec, path.posix.join(dir, spec));
          else if (/features\/[^/]+\//.test(spec)) fromPath(line, spec, `src/${spec.slice(spec.indexOf('features/'))}`);
        }
        break;
      case 'dart':
        for (const m of text.matchAll(/^\s*(?:import|export)\s+'([^']+)'/g)) {
          const spec = m[1];
          if (spec.startsWith('package:')) {
            const [pkg, ...rest] = spec.slice('package:'.length).split('/');
            if (pkg === ctx.dartPackage) fromPath(line, spec, `lib/${rest.join('/')}`);
          } else if (!spec.startsWith('dart:')) {
            fromPath(line, spec, path.posix.join(dir, spec));
          }
        }
        break;
      case 'python': {
        const rel = text.match(/^\s*from\s+(\.+)([\w.]*)\s+import/);
        if (rel) {
          const up = rel[1].length - 1;
          const base = up > 0 ? path.posix.join(dir, ...Array(up).fill('..')) : dir;
          fromPath(line, `${rel[1]}${rel[2]}`, path.posix.join(base, rel[2].replace(/\./g, '/')));
        }
        const abs = text.match(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/);
        const mod = abs?.[1] ?? abs?.[2];
        if (mod && mod.includes('.slices.')) fromPath(line, mod, mod.replace(/\./g, '/'));
        break;
      }
      case 'rust':
        for (const m of text.matchAll(/\buse\s+((?:crate|super|self)(?:::\w+)*)(?:::\{([^}]*)\})?/g)) {
          const segments = m[1].split('::');
          const modulePath = rustModulePath(ctx.relPath);
          let resolved: string[];
          if (segments[0] === 'crate') resolved = segments.slice(1);
          else {
            resolved = [...modulePath];
            for (const s of segments) {
              if (s === 'super') resolved.pop();
              else if (s !== 'self') resolved.push(s);
            }
          }
          // `use super::{domain::X, service}` names modules inside the braces; `use super::domain::{X, Y}` names types.
          const candidates = m[2] && resolved.length < 3
            ? m[2].split(',').map((s) => [...resolved, s.trim().split('::')[0]]).filter((c) => c[c.length - 1])
            : [resolved];
          for (const c of candidates) {
            if (c[0] !== 'slices' || c.length < 2) continue;
            fromPath(line, m[0], c.length === 2 ? `src/slices/${c[1]}/mod.rs` : `src/slices/${c[1]}/${c[2]}.rs`);
          }
        }
        break;
      case 'go':
        for (const m of text.matchAll(/"([^"]*\/internal\/slices\/(\w+)[^"]*)"/g)) fromPath(line, m[1], `internal/slices/${m[2]}/module.go`);
        break;
      case 'csharp':
        for (const m of text.matchAll(/\bFeatures\.(\w+)(?:\.(\w+))?/g)) fromNamespace(line, m[0], m[1], m[2]);
        break;
      case 'php':
        for (const m of text.matchAll(/\\?App\\Features\\(\w+)(?:\\(\w+))?/g)) fromNamespace(line, m[0], m[1], m[2]);
        break;
      case 'ruby': {
        const req = text.match(/^\s*require_relative\s+['"]([^'"]+)['"]/);
        if (req) fromPath(line, req[1], path.posix.join(dir, req[1]));
        for (const m of text.matchAll(/\b([A-Z]\w*)::(Domain|Application|Infrastructure|Presentation|Composition)\b/g)) {
          fromNamespace(line, m[0], m[1], m[2]);
        }
        break;
      }
      case 'elixir':
        if (ctx.elixirModule) {
          const re = new RegExp(`\\b${ctx.elixirModule}\\.([A-Z]\\w*)(?:\\.([A-Z]\\w*))?`, 'g');
          for (const m of text.matchAll(re)) {
            // The context module (Orders.OrdersContext) is a slice's public API; anything else is internal.
            const isPublicApi = !m[2] || m[2] === `${m[1]}Context`;
            fromNamespace(line, m[0], m[1], isPublicApi ? 'composition' : 'internal');
          }
        }
        break;
    }
  });
  return refs;
}

/** src/slices/orders/service.rs → [slices, orders, service]; mod.rs/lib.rs/main.rs collapse to their directory. */
function rustModulePath(relPath: string): string[] {
  const afterSrc = relPath.replace(/^.*?src\//, '').replace(/\.rs$/, '').split('/');
  const last = afterSrc[afterSrc.length - 1];
  return last === 'mod' || last === 'lib' || last === 'main' ? afterSrc.slice(0, -1) : afterSrc;
}
