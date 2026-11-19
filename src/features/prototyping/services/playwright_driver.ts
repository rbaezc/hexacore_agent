import * as path from 'node:path';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { UiFinding } from '../domain/prototype_types.js';
import { RENDER_PROBE } from './render_probe.js';

export interface RenderPass {
  viewport: 'mobile' | 'desktop';
  width: number;
  height: number;
  theme: 'light' | 'dark';
}

export interface RenderResult {
  pass: RenderPass;
  findings: UiFinding[];
  /** Full-page PNG written to disk. */
  screenshot?: string;
  /** First screen as a small JPEG (base64), for the model to look at. */
  preview?: string;
}

/** Renders a page in a real browser. Injected so the audit is testable without one. */
export interface BrowserDriver {
  render(url: string, passes: RenderPass[], shotsDir?: string): Promise<RenderResult[]>;
}

export const RENDER_PASSES: RenderPass[] = [
  { viewport: 'mobile', width: 390, height: 844, theme: 'light' },
  { viewport: 'mobile', width: 390, height: 844, theme: 'dark' },
  { viewport: 'desktop', width: 1280, height: 800, theme: 'light' },
  { viewport: 'desktop', width: 1280, height: 800, theme: 'dark' },
];

export const PLAYWRIGHT_MISSING =
  'Browser checks need Playwright in this project: npm i -D playwright && npx playwright install chromium. Static checks still ran.';

/**
 * Finds Playwright in the project first (it is a heavy, optional dependency HexaCore does not
 * bundle), then next to HexaCore itself. Returns undefined when it is not installed.
 */
export function loadPlaywright(projectRoot: string): any | undefined {
  const requirers = [createRequire(path.join(projectRoot, 'package.json')), createRequire(import.meta.url)];
  for (const req of requirers) {
    for (const id of ['playwright', 'playwright-core']) {
      try {
        return req(id);
      } catch {
        // try the next location
      }
    }
  }
  return undefined;
}

export class PlaywrightDriver implements BrowserDriver {
  constructor(private readonly playwright: any) {}

  async render(url: string, passes: RenderPass[], shotsDir?: string): Promise<RenderResult[]> {
    const browser = await this.playwright.chromium.launch({ headless: true });
    try {
      const results: RenderResult[] = [];
      if (shotsDir) await mkdir(shotsDir, { recursive: true });
      for (const pass of passes) results.push(await this.renderPass(browser, url, pass, shotsDir));
      return results;
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  private async renderPass(browser: any, url: string, pass: RenderPass, shotsDir?: string): Promise<RenderResult> {
    const context = await browser.newContext({ viewport: { width: pass.width, height: pass.height }, colorScheme: pass.theme, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const findings: UiFinding[] = [];
    const where = { viewport: pass.viewport, theme: pass.theme } as const;
    page.on('console', (msg: any) => {
      if (msg.type() === 'error') findings.push({ rule: 'ui/console-error', severity: 'error', message: `Console error: ${String(msg.text()).slice(0, 300)}`, ...where });
    });
    page.on('pageerror', (error: Error) => findings.push({ rule: 'ui/console-error', severity: 'error', message: `Uncaught error: ${error.message.slice(0, 300)}`, ...where }));
    page.on('requestfailed', (req: any) => {
      const failed = String(req.url());
      if (!failed.startsWith('data:') && !failed.endsWith('/favicon.ico')) {
        findings.push({ rule: 'ui/failed-request', severity: 'warning', message: `Could not load ${failed.slice(0, 200)} (${req.failure()?.errorText ?? 'failed'})`, ...where });
      }
    });
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 20_000 });
      await page.evaluate('document.fonts ? document.fonts.ready.then(() => true) : true').catch(() => undefined);
      const probed: UiFinding[] = await page.evaluate(RENDER_PROBE);
      findings.push(...probed.map((f) => ({ ...f, ...where })));
      let screenshot: string | undefined;
      if (shotsDir) {
        screenshot = path.join(shotsDir, `${pass.viewport}-${pass.theme}.png`);
        await page.screenshot({ path: screenshot, fullPage: true });
      }
      const preview = (await page.screenshot({ type: 'jpeg', quality: 70 })).toString('base64');
      return { pass, findings, screenshot, preview };
    } finally {
      await context.close().catch(() => undefined);
    }
  }
}
