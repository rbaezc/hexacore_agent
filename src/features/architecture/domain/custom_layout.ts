import { ArchitectureViolation, SourceLocation } from './architecture_types.js';

/** What a layer may do, from hexacore.json `architecture.layers`. */
export interface LayerRule {
  /** The name as written in the config, for messages. */
  name: string;
  /** Other slices may use it (Contracts, a public API). */
  public: boolean;
  /** Layers of the same slice it may use (lowercase); undefined = unrestricted. */
  dependsOn?: Set<string>;
}

interface Pattern {
  regex: RegExp;
}

/** A project's own vertical-slice convention (ADR 4). */
export interface CustomLayout {
  paths: Pattern[];
  namespaces: Pattern[];
  layers: Map<string, LayerRule>;
  ignore: RegExp[];
  maxFileLines?: number;
}

const escape = (s: string) => s.replace(/[.+^$()|[\]\\]/g, '\\$&');

/** Path glob with {slice}/{layer} captures: ** spans directories, * stays inside one. */
function compilePath(pattern: string): RegExp {
  let out = '';
  let slices = 0;
  for (const token of pattern.replace(/\\/g, '/').split(/(\{slice\}|\{layer\}|\*\*\/?|\*|\?)/)) {
    if (token === '{slice}') out += slices++ === 0 ? '(?<slice>[^/.]+)' : '\\k<slice>';
    else if (token === '{layer}') out += '(?<layer>[^/.]+)';
    else if (token === '**/') out += '(?:.*/)?';
    else if (token === '**') out += '.*';
    else if (token === '*') out += '[^/]*';
    else if (token === '?') out += '[^/]';
    else out += escape(token);
  }
  return new RegExp(`^${out}$`);
}

/** Dotted namespace pattern; anything after it (sub-namespaces) still belongs to the match. */
function compileNamespace(pattern: string): RegExp {
  let slices = 0;
  const body = pattern
    .split(/(\{slice\}|\{layer\})/)
    .map((t) => (t === '{slice}' ? (slices++ === 0 ? '(?<slice>\\w+)' : '\\k<slice>') : t === '{layer}' ? '(?<layer>\\w+)' : escape(t)))
    .join('');
  return new RegExp(`^${body}(?:\\.[\\w.]*)?$`);
}

const strings = (v: unknown): string[] | undefined => (Array.isArray(v) && v.every((s) => typeof s === 'string') ? v : undefined);

/** Reads hexacore.json `architecture`; no `layout` means the built-in layouts. */
export function parseCustomLayout(arch: any): { layout?: CustomLayout; errors: string[] } {
  if (!arch || arch.layout === undefined) return { errors: [] };
  const errors: string[] = [];
  const layout = strings(arch.layout);
  if (!layout || layout.length === 0) return { errors: ['architecture.layout must be a non-empty list of path patterns'] };
  for (const p of layout) if (!p.includes('{slice}')) errors.push(`layout pattern '${p}' has no {slice}`);

  const namespaces = arch.namespaces === undefined ? [] : strings(arch.namespaces);
  if (!namespaces) errors.push('architecture.namespaces must be a list of patterns like "{slice}.{layer}"');
  for (const p of namespaces ?? []) if (!p.includes('{slice}')) errors.push(`namespace pattern '${p}' has no {slice}`);

  const layers = new Map<string, LayerRule>();
  if (arch.layers !== undefined && (typeof arch.layers !== 'object' || Array.isArray(arch.layers))) errors.push('architecture.layers must be an object');
  for (const [name, raw] of Object.entries<any>(arch.layers && typeof arch.layers === 'object' ? arch.layers : {})) {
    const deps = raw?.dependsOn === undefined ? undefined : strings(raw.dependsOn);
    if (raw?.dependsOn !== undefined && !deps) errors.push(`layers.${name}.dependsOn must be a list of layer names`);
    const unrestricted = !deps || deps.includes('*');
    layers.set(name.toLowerCase(), { name, public: raw?.public === true, dependsOn: unrestricted ? undefined : new Set(deps.map((d) => d.toLowerCase())) });
  }

  const ignore = arch.ignore === undefined ? [] : strings(arch.ignore);
  if (!ignore) errors.push('architecture.ignore must be a list of globs');
  const max = arch.maxFileLines;
  if (max !== undefined && !(Number.isInteger(max) && max > 0)) errors.push('architecture.maxFileLines must be a positive whole number');

  if (errors.length) return { errors };
  return {
    layout: {
      paths: layout.map((p) => ({ regex: compilePath(p) })),
      namespaces: (namespaces ?? []).map((p) => ({ regex: compileNamespace(p) })),
      layers,
      ignore: (ignore ?? []).map(compilePath),
      maxFileLines: max,
    },
    errors,
  };
}

const TEST_FILE = /([._-](test|spec)\.\w+|Tests?\.cs|_spec\.rb|_test\.go)$/;

/** Test files by name (a.spec.ts, PredioTests.cs), wherever they live. */
export const isTestFile = (relPath: string) => TEST_FILE.test(relPath);

const toLocation = (m: RegExpMatchArray | null): SourceLocation | undefined => {
  const slice = m?.groups?.slice;
  if (!slice) return undefined;
  const layer = m.groups?.layer?.toLowerCase();
  return layer ? { slice: slice.toLowerCase(), role: 'unknown', layer } : { slice: slice.toLowerCase(), role: 'module' };
};

export function classifyCustomPath(layout: CustomLayout, relPath: string): SourceLocation | undefined {
  const p = relPath.replace(/\\/g, '/');
  for (const { regex } of layout.paths) {
    const loc = toLocation(p.match(regex));
    // Tests kept next to the code (*.spec.ts, FooTests.cs) are exempt from layer rules, as in the built-in layouts.
    if (loc) return TEST_FILE.test(p) ? { ...loc, role: 'test' } : loc;
  }
  return undefined;
}

export function classifyNamespace(layout: CustomLayout, namespace: string): SourceLocation | undefined {
  for (const { regex } of layout.namespaces) {
    const loc = toLocation(namespace.match(regex));
    if (loc) return loc;
  }
  return undefined;
}

export const isIgnoredByLayout = (layout: CustomLayout, relPath: string) => layout.ignore.some((r) => r.test(relPath.replace(/\\/g, '/')));

/** The custom rules: public layers across slices, dependsOn inside a slice. */
export function evaluateCustom(
  layout: CustomLayout,
  file: string,
  from: SourceLocation,
  to: SourceLocation,
  line: number,
  specifier: string,
  composition: ReadonlySet<string>
): ArchitectureViolation | undefined {
  const rule = (layer?: string) => (layer ? layout.layers.get(layer) : undefined);
  const label = (loc: SourceLocation) => (loc.layer ? (rule(loc.layer)?.name ?? loc.layer) : 'root');
  if (from.slice !== to.slice) {
    if (to.layer && rule(to.layer)?.public) return undefined;
    const internal = Boolean(to.layer);
    if (!internal && composition.has(from.slice)) return undefined;
    const publicLayers = [...layout.layers.values()].filter((l) => l.public).map((l) => l.name);
    return {
      rule: 'CROSS_SLICE_COUPLING',
      severity: internal ? 'error' : 'warning',
      file,
      line,
      message: `Slice '${from.slice}' uses ${internal ? `the ${label(to)} layer` : 'the root'} of slice '${to.slice}' (${specifier}).${publicLayers.length ? ` Other slices may only use: ${publicLayers.join(', ')}.` : ''}`,
    };
  }
  const allowed = rule(from.layer)?.dependsOn;
  if (!allowed || !to.layer || to.layer === from.layer || !layout.layers.has(to.layer) || allowed.has(to.layer)) return undefined;
  return {
    rule: 'LAYER_DEPENDENCY_VIOLATION',
    severity: 'error',
    file,
    line,
    message: `${label(from)} depends on ${label(to)} (${specifier}); ${label(from)} may only depend on: ${[...allowed].map((l) => rule(l)?.name ?? l).join(', ') || 'nothing else'}.`,
  };
}
