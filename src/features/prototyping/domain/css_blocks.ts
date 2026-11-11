/** A `prelude { … }` block of a stylesheet, with the preludes of the blocks around it (e.g. an @media). */
export interface CssBlock {
  prelude: string;
  ancestors: string[];
  bodyStart: number;
  bodyEnd: number;
}

/** A custom property definition or a `var()` use, with the blocks that contain it. */
export interface TokenSite {
  name: string;
  value?: string;
  index: number;
  context: string[];
  hasFallback?: boolean;
}

/**
 * Splits CSS into blocks with a single pass that skips comments and strings. Good enough for
 * auditing hand-written and generated stylesheets; it is not a validating parser.
 */
export function cssBlocks(css: string): CssBlock[] {
  const out: CssBlock[] = [];
  const stack: Omit<CssBlock, 'bodyEnd'>[] = [];
  let preludeStart = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? css.length : end + 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== ch) j += css[j] === '\\' ? 2 : 1;
      i = j;
      continue;
    }
    if (ch === '{') {
      stack.push({ prelude: css.slice(preludeStart, i).replace(/\/\*[\s\S]*?\*\//g, '').trim(), ancestors: stack.map((b) => b.prelude), bodyStart: i + 1 });
      preludeStart = i + 1;
    } else if (ch === '}') {
      const block = stack.pop();
      if (block) out.push({ ...block, bodyEnd: i });
      preludeStart = i + 1;
    } else if (ch === ';') {
      preludeStart = i + 1;
    }
  }
  return out;
}

/** Preludes of the innermost block containing `index`, outermost first. */
export function contextAt(blocks: CssBlock[], index: number): string[] {
  let best: CssBlock | undefined;
  for (const b of blocks) {
    if (index >= b.bodyStart && index < b.bodyEnd && (!best || b.bodyEnd - b.bodyStart < best.bodyEnd - best.bodyStart)) best = b;
  }
  return best ? [...best.ancestors, best.prelude] : [];
}

const DARK_CONTEXT = /prefers-color-scheme\s*:\s*dark|data-theme\s*=\s*["']?dark|(^|[\s,>+~])\.dark\b/i;

/** Whether a definition only applies in dark mode. */
export function isDarkContext(context: string[]): boolean {
  return context.some((p) => DARK_CONTEXT.test(p));
}

export function isInsideMedia(context: string[]): boolean {
  return context.some((p) => /^@media\b/i.test(p));
}

export function tokenDefinitions(css: string, blocks: CssBlock[] = cssBlocks(css)): TokenSite[] {
  const sites: TokenSite[] = [];
  for (const m of css.matchAll(/(?<![\w-])(--[\w-]+)\s*:\s*([^;{}]*)/g)) {
    const context = contextAt(blocks, m.index!);
    // A `--x:` outside any block is not a declaration (it can only be noise in a selector).
    if (context.length) sites.push({ name: m[1], value: m[2].trim(), index: m.index!, context });
  }
  return sites;
}

export function tokenUses(css: string, blocks: CssBlock[] = cssBlocks(css)): TokenSite[] {
  return [...css.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)].map((m) => ({ name: m[1], index: m.index!, context: contextAt(blocks, m.index!), hasFallback: Boolean(m[2]) }));
}

/** The design tokens of a page, per theme: what a framework port of the prototype should carry over. */
export function designTokens(cssSources: string[]): { light: Record<string, string>; dark: Record<string, string> } {
  const light: Record<string, string> = {};
  const dark: Record<string, string> = {};
  for (const css of cssSources) {
    for (const def of tokenDefinitions(css)) (isDarkContext(def.context) ? dark : light)[def.name] = def.value ?? '';
  }
  return { light, dark };
}

/** `<style>` contents of an HTML page with their offsets, so findings point at the page's own lines. */
export function inlineStyles(html: string): { css: string; offset: number }[] {
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => ({ css: m[1], offset: m.index! + m[0].indexOf('>') + 1 }));
}

export function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}
