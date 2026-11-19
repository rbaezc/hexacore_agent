import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { IFileSystem } from '../../../shared/infrastructure/file_system.js';
import { WorkspaceContext } from '../../../shared/infrastructure/workspace.js';
import { AttachedImage } from '../../../shared/domain/attachments.js';
import { UiAuditReport, UiFinding, UiTarget } from '../domain/prototype_types.js';
import { PageSource, STATIC_RULES, staticAudit } from '../domain/ui_rules.js';
import { RENDER_RULES } from './render_probe.js';
import { BrowserDriver, PLAYWRIGHT_MISSING, RENDER_PASSES } from './playwright_driver.js';
import { PreviewServer } from './preview_server.js';
import { PrototypeStore } from './prototype_store.js';

/** The previews worth showing the model: one phone screen in light mode, one desktop screen in dark mode. */
const PREVIEWED = [
  { viewport: 'mobile', theme: 'light' },
  { viewport: 'desktop', theme: 'dark' },
] as const;

/**
 * The 'ui' check: static rules over the page source, then (when Playwright is installed) a
 * rendered pass at phone and desktop width in light and dark mode, with screenshots.
 */
export class UiAuditor {
  constructor(
    private readonly fileSystem: IFileSystem,
    private readonly workspace: WorkspaceContext,
    private readonly store: PrototypeStore,
    private readonly preview: PreviewServer,
    /** Returns undefined when no browser is available. */
    private readonly driver: () => BrowserDriver | undefined
  ) {}

  async audit(target: UiTarget, options: { render?: boolean } = {}): Promise<UiAuditReport> {
    const sources: PageSource[] = [];
    for (const file of target.files) {
      const content = await this.fileSystem.readFile(file).catch(() => undefined);
      if (content !== undefined) sources.push({ file: this.workspace.relative(file), content, kind: /\.css$/i.test(file) ? 'css' : 'html' });
    }
    const findings: UiFinding[] = sources.length ? staticAudit(sources) : [];
    const report: UiAuditReport = { target: target.label, rulesChecked: sources.length ? [...STATIC_RULES] : [], findings, rendered: false, screenshots: [], images: [] };
    if (options.render === false) return report;

    const url = await this.urlFor(target);
    const driver = this.driver();
    if (!url) report.renderSkipped = 'Nothing to render: the target has no page to open.';
    else if (!driver) report.renderSkipped = PLAYWRIGHT_MISSING;
    if (!url || !driver) return report;

    try {
      const results = await driver.render(url, RENDER_PASSES, this.shotsDir(target));
      report.rendered = true;
      report.rulesChecked.push(...RENDER_RULES);
      report.findings.push(...dedupe(results.flatMap((r) => r.findings.map((f) => ({ viewport: r.pass.viewport, theme: r.pass.theme, ...f })))));
      report.screenshots = results.flatMap((r) => (r.screenshot ? [this.workspace.relative(r.screenshot)] : []));
      report.images = PREVIEWED.flatMap((p) => {
        const r = results.find((x) => x.pass.viewport === p.viewport && x.pass.theme === p.theme);
        return r?.preview ? [{ mimeType: 'image/jpeg', data: r.preview, label: `${target.label} · ${p.viewport} · ${p.theme}` } satisfies AttachedImage] : [];
      });
    } catch (error: any) {
      const message = String(error?.message ?? error).split('\n')[0];
      report.renderSkipped = /Executable doesn't exist|install/i.test(message)
        ? `Playwright is installed but its browser is not: run npx playwright install chromium. (${message.slice(0, 160)})`
        : `The browser could not render the page: ${message.slice(0, 200)}`;
    }
    return report;
  }

  private async urlFor(target: UiTarget): Promise<string | undefined> {
    if (target.prototype) {
      const served = await this.preview.url(target.prototype.name);
      return served ?? pathToFileURL(path.join(this.store.dir(target.prototype.name), 'index.html')).href;
    }
    return target.url;
  }

  private shotsDir(target: UiTarget): string {
    if (target.prototype) return path.join(this.store.root(), '.shots', target.prototype.name, `v${target.prototype.version}`);
    const slug = target.label.toLowerCase().replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'page';
    return this.workspace.hexagenPath('ui-shots', slug);
  }
}

/** The same problem in several passes is reported once, with the first pass that showed it. */
function dedupe(findings: UiFinding[]): UiFinding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.rule}|${f.selector ?? ''}|${f.rule === 'ui/contrast' ? f.theme : ''}|${f.rule.startsWith('ui/console') || f.rule === 'ui/failed-request' ? f.message : ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
