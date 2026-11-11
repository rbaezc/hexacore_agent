import { UiFinding } from './prototype_types.js';
import { cssBlocks, inlineStyles, isDarkContext, isInsideMedia, lineAt, tokenDefinitions, tokenUses } from './css_blocks.js';

/** A page file to audit: HTML (its inline styles included) or a stylesheet it links. */
export interface PageSource {
  /** Workspace-relative path, used in findings. */
  file: string;
  content: string;
  kind: 'html' | 'css';
}

export const STATIC_RULES = [
  'ui/viewport-meta',
  'ui/title',
  'ui/html-lang',
  'ui/undefined-token',
  'ui/dark-only-token',
  'ui/no-dark-mode',
  'ui/body-background',
  'ui/fixed-width',
  'ui/img-alt',
  'ui/control-name',
  'ui/input-label',
  'ui/heading-order',
  'ui/broken-anchor',
  'ui/unpinned-cdn',
] as const;

const MAX_PHONE_WIDTH = 480;

interface Stylesheet {
  file: string;
  css: string;
  /** Where `css` starts in the file, so lines match the file the developer opens. */
  offset: number;
  source: string;
}

/**
 * Checks a page without a browser: what can be known from its source (missing metadata, tokens
 * that resolve to nothing in one theme, unlabeled controls, broken anchors…). Always available.
 */
export function staticAudit(sources: PageSource[]): UiFinding[] {
  const findings: UiFinding[] = [];
  const sheets: Stylesheet[] = sources.flatMap((s) =>
    s.kind === 'css' ? [{ file: s.file, css: s.content, offset: 0, source: s.content }] : inlineStyles(s.content).map((st) => ({ file: s.file, ...st, source: s.content }))
  );
  findings.push(...tokenFindings(sheets), ...layoutFindings(sheets, sources));
  for (const page of sources.filter((s) => s.kind === 'html')) findings.push(...htmlFindings(page));
  return findings;
}

function at(sheet: Stylesheet, index: number): { file: string; line: number } {
  return { file: sheet.file, line: lineAt(sheet.source, sheet.offset + index) };
}

function tokenFindings(sheets: Stylesheet[]): UiFinding[] {
  const findings: UiFinding[] = [];
  const parsed = sheets.map((sheet) => {
    const blocks = cssBlocks(sheet.css);
    return { sheet, defs: tokenDefinitions(sheet.css, blocks), uses: tokenUses(sheet.css, blocks) };
  });
  const defs = parsed.flatMap((p) => p.defs);
  const defined = new Set(defs.map((d) => d.name));
  const definedForLight = new Set(defs.filter((d) => !isDarkContext(d.context)).map((d) => d.name));

  const reported = new Set<string>();
  for (const { sheet, uses } of parsed) {
    for (const use of uses) {
      if (use.hasFallback || reported.has(use.name)) continue;
      if (!defined.has(use.name)) {
        reported.add(use.name);
        findings.push({ rule: 'ui/undefined-token', severity: 'error', message: `var(${use.name}) is used but never defined, so it resolves to nothing. Define it on :root.`, ...at(sheet, use.index) });
      } else if (!definedForLight.has(use.name) && !isDarkContext(use.context)) {
        reported.add(use.name);
        findings.push({ rule: 'ui/dark-only-token', severity: 'error', message: `${use.name} is only defined for dark mode; in light mode it resolves to nothing. Define its light value on :root first.`, ...at(sheet, use.index) });
      }
    }
  }

  const hasDark = defs.some((d) => isDarkContext(d.context)) || sheets.some((s) => /prefers-color-scheme\s*:\s*dark|color-scheme\s*:\s*dark/i.test(s.css));
  if (sheets.length && !hasDark) {
    findings.push({ rule: 'ui/no-dark-mode', severity: 'warning', message: 'The page has no dark mode. Redefine the color tokens under @media (prefers-color-scheme: dark), or set color-scheme: dark if it is dark only.', file: sheets[0].file, line: at(sheets[0], 0).line });
  }
  return findings;
}

function layoutFindings(sheets: Stylesheet[], sources: PageSource[]): UiFinding[] {
  const findings: UiFinding[] = [];
  let background = false;
  for (const sheet of sheets) {
    const blocks = cssBlocks(sheet.css);
    for (const b of blocks) {
      const selectors = b.prelude.split(',').map((s) => s.trim().toLowerCase());
      if (selectors.some((s) => s === 'body' || s === 'html') && /background(-color)?\s*:/i.test(sheet.css.slice(b.bodyStart, b.bodyEnd))) background = true;
    }
    for (const m of sheet.css.matchAll(/(?<![\w-])(min-width|width)\s*:\s*(\d+(?:\.\d+)?)px/gi)) {
      // `@media (min-width: 900px) {` is a condition, not a declaration.
      const after = sheet.css.slice(m.index!);
      if (after[after.search(/[;{}]/)] === '{') continue;
      const block = blocks.find((b) => m.index! >= b.bodyStart && m.index! < b.bodyEnd);
      const context = block ? [...block.ancestors, block.prelude] : [];
      if (Number(m[2]) > MAX_PHONE_WIDTH && !isInsideMedia(context)) {
        findings.push({ rule: 'ui/fixed-width', severity: 'warning', message: `${m[1]}: ${m[2]}px is wider than a phone and will scroll sideways. Use max-width, a percentage or minmax(0, 1fr).`, ...at(sheet, m.index!) });
      }
    }
  }
  const page = sources.find((s) => s.kind === 'html');
  if (sheets.length && page && !background) {
    findings.push({ rule: 'ui/body-background', severity: 'warning', message: 'body sets no background, so the page shows whatever the browser or host paints. Give body a background from a token.', file: page.file, line: 1 });
  }
  return findings;
}

function htmlFindings(page: PageSource): UiFinding[] {
  const html = page.content;
  const findings: UiFinding[] = [];
  const add = (rule: string, severity: UiFinding['severity'], message: string, index = 0) => findings.push({ rule, severity, message, file: page.file, line: lineAt(html, index) });
  const body = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, (m) => m.replace(/[^\n]/g, ' '));

  if (!/<meta\b[^>]*name=["']viewport["']/i.test(html)) add('ui/viewport-meta', 'error', 'Missing <meta name="viewport" content="width=device-width, initial-scale=1">: phones will render the page zoomed out.');
  if (!/<title>\s*[^<\s][^<]*<\/title>/i.test(html)) add('ui/title', 'error', 'Missing <title>: the tab, bookmarks and shared links have no name.');
  const htmlTag = /<html\b([^>]*)>/i.exec(html);
  if (!htmlTag || !/\blang=/i.test(htmlTag[1])) add('ui/html-lang', 'warning', 'Set <html lang="…"> so screen readers pronounce the page correctly.', htmlTag?.index ?? 0);

  for (const m of body.matchAll(/<img\b([^>]*)>/gi)) {
    if (!/\balt=/i.test(m[1])) add('ui/img-alt', 'error', 'Image without alt text. Describe it, or use alt="" when it is decorative.', m.index);
  }
  for (const m of body.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const text = m[3].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    const named = /\baria-label(ledby)?=["'][^"']+|\btitle=["'][^"']+/i.test(m[2]) || /<img\b[^>]*\balt=["'][^"']+/i.test(m[3]) || /<title>[^<]+<\/title>/i.test(m[3]);
    if (!text && !named) add('ui/control-name', 'error', `<${m[1]}> has no accessible name. Give it text or aria-label.`, m.index);
  }
  for (const m of body.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)) {
    if (/\btype=["']?(hidden|submit|button|reset|image)\b/i.test(m[2]) || /\baria-label(ledby)?=|\btitle=/i.test(m[2])) continue;
    const id = /\bid=["']([^"']+)["']/i.exec(m[2])?.[1];
    const labelled = id && new RegExp(`<label\\b[^>]*\\bfor=["']${escapeRegExp(id)}["']`, 'i').test(body);
    const wrapped = body.lastIndexOf('<label', m.index) > body.lastIndexOf('</label', m.index);
    if (!labelled && !wrapped) add('ui/input-label', 'warning', `<${m[1]}> has no label. Use <label for="…"> or aria-label; a placeholder is not a label.`, m.index);
  }

  let previous = 0;
  let h1s = 0;
  for (const m of body.matchAll(/<h([1-6])\b/gi)) {
    const level = Number(m[1]);
    if (level === 1 && ++h1s === 2) add('ui/heading-order', 'warning', 'More than one <h1>: keep a single main heading.', m.index);
    if (previous && level > previous + 1) add('ui/heading-order', 'warning', `<h${level}> follows <h${previous}>: heading levels should not skip.`, m.index);
    previous = level;
  }

  const ids = new Set([...html.matchAll(/\b(?:id|name)=["']([^"']+)["']/gi)].map((m) => m[1]));
  for (const m of body.matchAll(/\bhref=["']#([^"']*)["']/gi)) {
    if (m[1] === '') add('ui/broken-anchor', 'warning', 'href="#" goes nowhere. Link to a real section or use a <button>.', m.index);
    else if (m[1] !== 'top' && !ids.has(decodeURIComponent(m[1]))) add('ui/broken-anchor', 'error', `Link to #${m[1]}, but no element has id="${m[1]}".`, m.index);
  }
  for (const m of html.matchAll(/<script\b[^>]*\bsrc=["'](?:https?:)?\/\/(cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com)\/([^"']+)["']/gi)) {
    if (!/\d+\.\d+/.test(m[2])) add('ui/unpinned-cdn', 'warning', `Script from ${m[1]} without an exact version: it can change under you. Pin it, e.g. package@1.2.3.`, m.index);
  }
  return findings;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
