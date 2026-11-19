import * as http from 'node:http';
import * as path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { createTestHexaCore, TEST_ROOT } from '../helpers/test_hexacore.js';
import { createToolRegistry } from '../../src/features/mcp_server/infrastructure/mcp_server_factory.js';
import { toCallToolResult } from '../../src/features/mcp_server/infrastructure/mcp_stdio_server.js';
import { BrowserDriver, PreviewServer } from '../../src/features/prototyping/index.js';
import { InMemoryFileSystem } from '../helpers/in_memory_fs.js';
import type { HexaCoreOptions } from '../../src/composition_root.js';

const ctx = { reportProgress: async () => {} };

const PAGE = (body: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shop</title>
<style>
  :root { --bg: #fff; --fg: #111; }
  @media (prefers-color-scheme: dark) { :root { --bg: #111; --fg: #eee; } }
  body { background: var(--bg); color: var(--fg); }
</style>
</head>
<body>
${body}
</body>
</html>`;

function setup(hexacore: Partial<HexaCoreOptions> = {}) {
  const t = createTestHexaCore([0], { hexacore });
  const registry = createToolRegistry(t.services);
  const call = async (tool: string, input: Record<string, unknown> = {}): Promise<any> => {
    const res = await registry.call(tool, input, ctx);
    if (res.isFailure) throw res.error;
    return res.value;
  };
  return { ...t, call, registry };
}

const servers: PreviewServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.stop()));
});

function get(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string; location?: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c)).on('end', () => resolve({ status: res.statusCode ?? 0, body, location: res.headers.location }));
    }).on('error', reject);
  });
}

describe('prototypes', () => {
  it('saves versions as checkpoints, applies edits to a chosen base, and rolls back cleanly', async () => {
    const { call, fs } = setup();
    const v1 = await call('create_prototype', { name: 'Landing Page', html: PAGE('<h1>Hello</h1>'), target: 'docs/index.html' });
    expect(v1).toMatchObject({ name: 'landing-page', version: 1, files: ['index.html'], dir: '.hexagen/prototypes/landing-page', staticAudit: { passed: true } });
    expect(v1.previewUrl).toBeUndefined();

    const v2 = await call('create_prototype', { name: 'landing-page', edits: [{ oldText: '<h1>Hello</h1>', newText: '<h1>Hi</h1>' }], note: 'shorter' });
    expect(v2).toMatchObject({ version: 2, basedOn: 1 });
    const v3 = await call('create_prototype', { name: 'landing-page', basedOn: 1, edits: [{ oldText: 'Hello', newText: 'Welcome' }] });
    expect(v3).toMatchObject({ version: 3, basedOn: 1 });
    const current = path.join(TEST_ROOT, '.hexagen/prototypes/landing-page/index.html');
    expect(await fs.readFile(current)).toContain('<h1>Welcome</h1>');
    expect(await fs.readFile(path.join(TEST_ROOT, '.hexagen/prototypes/.versions/landing-page/v2/index.html'))).toContain('<h1>Hi</h1>');

    await expect(call('create_prototype', { name: 'landing-page', edits: [{ oldText: 'nope', newText: 'x' }] })).rejects.toThrow('Edit 1: oldText was not found');
    await expect(call('create_prototype', { name: 'landing-page', edits: [{ oldText: '-', newText: 'x' }] })).rejects.toThrow('more than once');
    await expect(call('create_prototype', { name: 'x', files: [{ path: '../evil.js', content: '' }] })).rejects.toThrow('Invalid prototype file');

    await call('rollback_changes', { checkpointId: v3.checkpointId });
    expect(await fs.readFile(current)).toContain('<h1>Hi</h1>');
    const listed = (await call('list_prototypes')).prototypes;
    expect(listed).toMatchObject([{ name: 'landing-page', current: 2, target: 'docs/index.html' }]);
    expect(listed[0].versions.map((v: any) => v.version)).toEqual([1, 2]);
  });

  it('serves prototypes on 127.0.0.1 only, read-only, with live reload for the current version', async () => {
    const fs = new InMemoryFileSystem({});
    const root = path.resolve('/w/.hexagen/prototypes');
    fs.files.set(path.join(root, 'shop/index.html'), '<html><body><p>current</p></body></html>');
    fs.files.set(path.join(root, '.versions/shop/v1/index.html'), '<html><body><p>first</p></body></html>');
    fs.files.set(path.join(root, '.meta/shop.json'), JSON.stringify({ current: 2 }));
    const server = new PreviewServer(fs, () => root, { port: 0, enabled: true });
    servers.push(server);
    const base = (await server.url())!;
    expect(base).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);

    expect((await get(base)).body).toContain('href="/shop/"');
    expect(await get(`${base}shop`)).toMatchObject({ status: 301, location: '/shop/' });
    const page = await get(`${base}shop/`);
    expect(page.body).toContain('current');
    expect(page.body).toContain("/__rev/shop");
    const archived = await get(`${base}shop/v1/`);
    expect(archived.body).toContain('first');
    expect(archived.body).not.toContain('__rev');
    expect((await get(`${base}__rev/shop`)).body).toBe('2');
    expect((await get(`${base}.meta/shop.json`)).status).toBe(404);
    expect((await get(`${base}shop/..%2F.meta%2Fshop.json`)).status).toBe(404);
    expect((await get(`${base}shop/`, { Host: 'evil.example:80' })).status).toBe(403);
  });

  it('runs the ui check on a prototype, and the learning loop sees the fix', async () => {
    const { call } = setup();
    await call('create_prototype', { name: 'shop', html: PAGE('<main><h1>Shop</h1><img src="hero.png"></main>') });

    const red = await call('run_quality_assurance', { stack: 'node', checks: ['ui'], target: 'shop' });
    expect(red.passed).toBe(false);
    const ui = red.results[0];
    expect(ui).toMatchObject({ check: 'ui', status: 'failed', target: 'shop', reportFormat: 'audit' });
    expect(ui.failures[0]).toMatchObject({ testName: 'ui/img-alt', file: '.hexagen/prototypes/shop/index.html', line: 14 });
    expect(ui.notes[0]).toContain('npm i -D playwright');

    await call('create_prototype', { name: 'shop', edits: [{ oldText: '<img src="hero.png">', newText: '<img src="hero.png" alt="Storefront">' }] });
    const green = await call('run_quality_assurance', { stack: 'node', checks: ['ui'] });
    expect(green.passed).toBe(true);
    expect(green.learning.resolved[0]).toMatchObject({ check: 'ui', changedFiles: ['.hexagen/prototypes/shop/index.html'] });
    expect(green.nextActions.join(' ')).toContain('record_lesson');
  });

  it('adds the browser findings and attaches screenshots for the model to see', async () => {
    const seen: string[] = [];
    const driver: BrowserDriver = {
      async render(url, passes) {
        seen.push(url);
        return passes.map((pass) => ({
          pass,
          findings: pass.viewport === 'mobile' ? [{ rule: 'ui/overflow', severity: 'error' as const, message: 'Wider than the screen', selector: 'div.stacks' }] : [],
          preview: Buffer.from(`${pass.viewport}-${pass.theme}`).toString('base64'),
        }));
      },
    };
    const { registry, call } = setup({ browserDriver: () => driver });
    await call('create_prototype', { name: 'shop', html: PAGE('<h1>Shop</h1>') });
    const result = await registry.call('run_quality_assurance', { stack: 'node', checks: ['ui'], target: 'shop' }, ctx);
    const ui = (result as any).value.results[0];
    expect(seen[0]).toMatch(/^file:/); // previews are off in tests: the page is opened from disk
    expect(ui.failures).toEqual([{ testName: 'ui/overflow (mobile, light)', errorMessage: 'Wider than the screen [div.stacks]' }]);
    expect(ui.command).toContain('static + browser');

    const mcp = toCallToolResult(result);
    const images = mcp.content.filter((c) => c.type === 'image');
    expect(images.map((i: any) => Buffer.from(i.data, 'base64').toString())).toEqual(['mobile-light', 'desktop-dark']);
    expect(JSON.stringify(mcp.structuredContent)).not.toContain('bW9iaWxl');
  });

  it('promotes a page through a checkpoint, and hands a framework target the tokens to port', async () => {
    const { call, fs } = setup();
    await call('create_prototype', { name: 'site', html: PAGE('<h1>v1</h1>'), files: [{ path: 'styles.css', content: '.x { color: red; }' }] });
    fs.files.set(path.join(TEST_ROOT, 'docs/index.html'), '<p>old site</p>');

    await expect(call('promote_prototype', { name: 'site', target: 'docs/index.html' })).rejects.toThrow('docs/index.html already exist');
    const copied = await call('promote_prototype', { name: 'site', target: 'docs/index.html', overwrite: true });
    expect(copied).toMatchObject({ mode: 'copied', version: 1, target: 'docs/index.html', written: ['docs/index.html', 'docs/styles.css'] });
    expect(copied.audit).toMatchObject({ check: 'ui', status: 'passed', target: 'docs/index.html' });
    expect(await fs.readFile(path.join(TEST_ROOT, 'docs/index.html'))).toContain('<h1>v1</h1>');
    expect((await call('list_prototypes')).prototypes[0].promotions).toMatchObject([{ version: 1, target: 'docs/index.html' }]);

    await call('rollback_changes', { checkpointId: copied.checkpointId });
    expect(await fs.readFile(path.join(TEST_ROOT, 'docs/index.html'))).toBe('<p>old site</p>');

    const port = await call('promote_prototype', { name: 'site', target: 'src/features/landing' });
    expect(port).toMatchObject({ mode: 'port', tokens: { light: { '--bg': '#fff' }, dark: { '--bg': '#111' } } });
    expect(port.nextActions.length).toBeGreaterThan(2);
    await expect(call('promote_prototype', { name: 'site', target: '.hexagen/x.html' })).rejects.toThrow('not into .hexagen');
  });

  it('only opens local URLs and explains what the ui check needs', async () => {
    const { call } = setup();
    await expect(call('run_quality_assurance', { stack: 'node', checks: ['ui'] })).rejects.toThrow('No target for the ui check');
    await expect(call('run_quality_assurance', { stack: 'node', checks: ['ui'], target: 'https://example.com' })).rejects.toThrow('only opens local URLs');
    const local = await call('run_quality_assurance', { stack: 'node', checks: ['ui'], target: 'http://localhost:5173' });
    expect(local.results[0]).toMatchObject({ status: 'passed', totalTests: 0 });
    expect(local.results[0].notes[0]).toContain('playwright');
  });
});
