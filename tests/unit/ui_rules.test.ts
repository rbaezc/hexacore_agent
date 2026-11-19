import { describe, it, expect } from 'vitest';
import { staticAudit, designTokens } from '../../src/features/prototyping/index.js';

const GOOD = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Orders</title>
<style>
  :root { --bg: #fff; --fg: #111; --accent: #a8600a; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #111; --fg: #eee; color-scheme: dark; } }
  body { background: var(--bg); color: var(--fg); }
  .wrap { max-width: 1120px; display: grid; grid-template-columns: minmax(0, 1fr); }
  @media (min-width: 900px) { .wide { width: 960px; } }
  a { color: var(--accent, blue); }
</style>
</head>
<body>
<main id="top">
  <h1>Orders</h1>
  <h2>Refunds</h2>
  <img src="x.png" alt="">
  <label for="q">Search</label><input id="q">
  <label>Email <input type="email"></label>
  <button aria-label="Close"><svg></svg></button>
  <a href="#top">Back to top</a>
</main>
<script src="https://cdn.jsdelivr.net/npm/htmx.org@2.0.4/dist/htmx.min.js"></script>
</body>
</html>`;

const BAD = `<html>
<head>
<style>
  :root { --bg: #fff; }
  @media (prefers-color-scheme: dark) { :root { --surface: #222; } }
  .card { background: var(--surface); color: var(--ink); }
  .table { min-width: 900px; }
</style>
</head>
<body>
<h1>One</h1>
<h3>Skipped a level</h3>
<h1>Two</h1>
<img src="hero.png">
<button></button>
<input placeholder="Email">
<a href="#pricing">Pricing</a>
<a href="#">Nowhere</a>
<script src="https://unpkg.com/htmx.org/dist/htmx.min.js"></script>
</body>
</html>`;

const rules = (html: string) => staticAudit([{ file: 'page.html', content: html, kind: 'html' }]);

describe('static UI rules', () => {
  it('passes a complete, themed, accessible page', () => {
    expect(rules(GOOD)).toEqual([]);
  });

  it('reports each problem with its rule, severity and line', () => {
    const findings = rules(BAD);
    const byRule = (rule: string) => findings.filter((f) => f.rule === rule);

    expect(byRule('ui/viewport-meta')[0].severity).toBe('error');
    expect(byRule('ui/title')).toHaveLength(1);
    expect(byRule('ui/html-lang')[0].severity).toBe('warning');
    expect(byRule('ui/undefined-token')[0]).toMatchObject({ severity: 'error', line: 6 });
    expect(byRule('ui/undefined-token')[0].message).toContain('--ink');
    expect(byRule('ui/dark-only-token')[0].message).toContain('--surface');
    expect(byRule('ui/fixed-width')[0]).toMatchObject({ severity: 'warning', line: 7 });
    expect(byRule('ui/body-background')).toHaveLength(1);
    expect(byRule('ui/img-alt')[0]).toMatchObject({ severity: 'error', line: 14 });
    expect(byRule('ui/control-name')[0].line).toBe(15);
    expect(byRule('ui/input-label')[0].line).toBe(16);
    expect(byRule('ui/heading-order').map((f) => f.line)).toEqual([12, 13]);
    expect(byRule('ui/broken-anchor').map((f) => f.severity)).toEqual(['error', 'warning']);
    expect(byRule('ui/unpinned-cdn')).toHaveLength(1);
    expect(findings.every((f) => f.file === 'page.html')).toBe(true);
  });

  it('warns when a styled page has no dark mode, and reads linked stylesheets with their own lines', () => {
    const html = GOOD.replace(/<style>[\s\S]*<\/style>/, '<link rel="stylesheet" href="app.css">');
    const css = ':root { --bg: #fff; --fg: #111; }\nbody { background: var(--bg); }\n.x { color: var(--missing); }';
    const findings = staticAudit([
      { file: 'page.html', content: html, kind: 'html' },
      { file: 'app.css', content: css, kind: 'css' },
    ]);
    expect(findings.find((f) => f.rule === 'ui/no-dark-mode')).toMatchObject({ severity: 'warning', file: 'app.css' });
    expect(findings.find((f) => f.rule === 'ui/undefined-token')).toMatchObject({ file: 'app.css', line: 3 });
  });

  it('extracts the design tokens per theme for a framework port', () => {
    const tokens = designTokens([':root { --bg: #fff; --accent: #a8600a; } @media (prefers-color-scheme: dark) { :root { --bg: #111; } }']);
    expect(tokens).toEqual({ light: { '--bg': '#fff', '--accent': '#a8600a' }, dark: { '--bg': '#111' } });
  });
});
