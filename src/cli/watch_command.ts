import * as path from 'node:path';
import { readFileSync } from 'node:fs';
import { createHexaCore, HexaCoreServices } from '../composition_root.js';
import { ok, fail } from '../shared/domain/result.js';
import { QACheck, TOOLCHAIN_CHECKS } from '../features/quality_assurance/domain/qa_types.js';
import {
  CheckRunner,
  NOTIFIER_NAMES,
  NodeFileWatcher,
  NotifierName,
  WatchService,
  WatchedResult,
  createIgnorePolicy,
  createNotifiers,
  detectLang,
} from '../features/watch/index.js';

type Flags = Record<string, string | boolean>;

const DEFAULT_CHECKS: QACheck[] = ['typecheck', 'test'];

function parseList<T extends string>(value: string | boolean | undefined, allowed: readonly T[], fallback: T[], what: string): T[] {
  if (typeof value !== 'string') return fallback;
  const items = value.split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = items.filter((i) => !allowed.includes(i as T));
  if (unknown.length) throw new Error(`Unknown ${what}: ${unknown.join(', ')} (use ${allowed.join(', ')})`);
  return items as T[];
}

/**
 * Adapts QA to the watcher: runs the checks for every detected stack and records each run the
 * way run_quality_assurance does (state history for resume_session, plus the learning loop).
 */
export function createCheckRunner(services: HexaCoreServices, targets: { stack: string; dir: string }[], checks: QACheck[]): CheckRunner {
  return async () => {
    const out: WatchedResult[] = [];
    for (const target of targets) {
      const cwd = services.workspace.resolveInside(target.dir);
      if (cwd.isFailure) return fail(cwd.error);
      const results = await services.qaRunner.runChecks({ stack: target.stack as any, cwd: cwd.value }, checks);
      if (results.isFailure) return fail(results.error);
      const at = new Date().toISOString();
      for (const r of results.value) {
        await services.stateRepo.recordQaRun({ stack: r.stack, check: r.check, status: r.status, failed: r.failedTestsCount, total: r.totalTests, at, source: 'watch' });
      }
      await services.learning.observe(results.value, services.workspace.relative(cwd.value));
      out.push(
        ...results.value.map((r) => ({
          stack: r.stack,
          check: r.check,
          status: r.status,
          failed: r.failedTestsCount,
          total: r.totalTests,
          failures: r.failures,
          skipReason: r.skipReason,
          durationMs: r.durationMs,
        }))
      );
    }
    return ok(out);
  };
}

/** `hexacore watch`: runs in the foreground until Ctrl+C. */
export async function runWatch(workspaceRoot: string | undefined, flags: Flags): Promise<number> {
  let checks: QACheck[];
  let notify: NotifierName[];
  try {
    checks = parseList(flags.checks, TOOLCHAIN_CHECKS, DEFAULT_CHECKS, 'check');
    notify = parseList(flags.notify, NOTIFIER_NAMES, [...NOTIFIER_NAMES], 'notifier');
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    return 1;
  }
  const debounceMs = typeof flags.debounce === 'string' && Number(flags.debounce) >= 0 ? Number(flags.debounce) : 2000;
  const lang = detectLang(typeof flags.lang === 'string' ? flags.lang : undefined);

  const services = createHexaCore({ workspaceRoot, preview: false });
  const root = services.workspace.root;
  const targets = await services.stackDetector.detect(root);
  if (targets.length === 0) {
    console.error(`Error: no supported stack found in ${root}.`);
    return 1;
  }
  let gitignore = '';
  try {
    gitignore = readFileSync(path.join(root, '.gitignore'), 'utf-8');
  } catch {
    // No .gitignore: the built-in list is enough.
  }

  const log = (line: string) => console.error(`[${new Date().toLocaleTimeString()}] ${line}`);
  const service = new WatchService({
    watcher: new NodeFileWatcher(root, (e) => log(`! watcher error: ${e.message}`)),
    run: createCheckRunner(services, targets, checks),
    notifiers: createNotifiers(notify, lang, log),
    isIgnored: createIgnorePolicy(gitignore),
    lang,
    debounceMs,
    multiStack: targets.length > 1,
    log,
  });

  log(`Watching ${root} — ${targets.map((t) => `${t.stack}${t.dir === '.' ? '' : ` (${t.dir})`}`).join(', ')}: ${checks.join(', ')}; alerts: ${notify.join(', ')} (${lang}). Ctrl+C to stop.`);
  const stop = () => {
    service.stop();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  await service.start();
  return new Promise<number>(() => undefined);
}
