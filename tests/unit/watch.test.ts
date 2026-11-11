import { describe, it, expect } from 'vitest';
import { ok, fail } from '../../src/shared/domain/result.js';
import {
  compareRuns,
  createIgnorePolicy,
  DesktopNotifier,
  detectLang,
  FileWatcher,
  Notifier,
  SpeechNotifier,
  spokenFileName,
  toAlert,
  WatchAlert,
  WatchedResult,
  WatchService,
} from '../../src/features/watch/index.js';
import { buildBriefing } from '../../src/features/state_management/services/session_briefing.js';

const result = (check: string, status: WatchedResult['status'], failed = 0, file?: string): WatchedResult => ({
  stack: 'node',
  check,
  status,
  failed,
  total: 10,
  failures: failed ? [{ file, line: 42, errorMessage: "Type 'string' is not assignable to type 'number'." }] : [],
});

class FakeWatcher implements FileWatcher {
  onChange?: (rel: string) => void;
  stopped = false;
  start(onChange: (rel: string) => void) {
    this.onChange = onChange;
  }
  stop() {
    this.stopped = true;
  }
}

class RecordingNotifier implements Notifier {
  alerts: WatchAlert[] = [];
  constructor(readonly name: string, readonly verbose = false, private readonly broken = false) {}
  async notify(alert: WatchAlert) {
    if (this.broken) throw new Error('no display');
    this.alerts.push(alert);
  }
}

function harness(runs: WatchedResult[][], opts: { slowMs?: number } = {}) {
  const watcher = new FakeWatcher();
  const console = new RecordingNotifier('console', true);
  const voice = new RecordingNotifier('voice');
  const calls: string[][] = [];
  const log: string[] = [];
  const service = new WatchService({
    watcher,
    notifiers: [console, voice, new RecordingNotifier('desktop', false, true)],
    isIgnored: createIgnorePolicy('reports/\n*.snap'),
    lang: 'es',
    debounceMs: 15,
    log: (l) => log.push(l),
    run: async (changed) => {
      calls.push(changed);
      if (opts.slowMs) await new Promise((r) => setTimeout(r, opts.slowMs));
      return ok(runs[Math.min(calls.length - 1, runs.length - 1)]);
    },
  });
  return { watcher, service, console, voice, calls, log, change: (p: string) => watcher.onChange!(p) };
}

describe('watch transitions', () => {
  it('interrupts only when a check changes colour; skipped checks keep the last status', () => {
    const first = compareRuns(new Map(), [result('typecheck', 'passed'), result('test', 'failed', 2)]);
    expect(first.map((t) => t.kind)).toEqual(['baseline_ok', 'baseline_failing']);

    const prev = new Map([['node:typecheck', 'passed' as const], ['node:test', 'failed' as const]]);
    const next = compareRuns(prev, [result('typecheck', 'failed', 1), result('test', 'passed'), result('lint', 'skipped')]);
    expect(next.map((t) => t.kind)).toEqual(['broke', 'fixed']);
    expect(compareRuns(new Map([['node:test', 'failed' as const]]), [result('test', 'failed', 3)])[0].kind).toBe('still_failing');
  });

  it('words alerts in Spanish and English with a speakable file name', () => {
    const broke = { kind: 'broke' as const, result: result('typecheck', 'failed', 1, 'src/features/qa/qa_runner_service.ts') };
    expect(toAlert(broke, 'es')).toMatchObject({
      important: true,
      level: 'error',
      title: '✗ Se rompió el typecheck',
      spoken: 'Se rompió el typecheck en qa runner service.',
    });
    expect(toAlert(broke, 'es').body).toContain('src/features/qa/qa_runner_service.ts:42');
    expect(toAlert({ kind: 'fixed', result: result('test', 'passed') }, 'es').spoken).toBe('Las pruebas vuelven a pasar.');
    expect(toAlert({ kind: 'broke', result: result('test', 'failed', 2, 'tests/unit/watch.test.ts') }, 'en').spoken).toBe('The tests broke in watch.');
    expect(toAlert({ kind: 'still_failing', result: result('test', 'failed', 2) }, 'en')).toMatchObject({ important: false, spoken: '' });
    expect(spokenFileName('a\\b\\user-profile.service.ts')).toBe('user profile service');

    // Exit-code-only runners: no "0 passing", no location printed twice.
    const bare = { ...result('test', 'passed'), total: 0 };
    expect(toAlert({ kind: 'fixed', result: bare }, 'es').body).toBe('');
    const repeated = { ...result('test', 'failed', 1), failures: [{ file: 'src/a.js', errorMessage: 'src/a.js:3 Error: wrong sum' }] };
    expect(toAlert({ kind: 'broke', result: repeated }, 'en').body).toBe('1 failing: src/a.js:3 Error: wrong sum');
  });

  it('picks the language from the flag, then HEXACORE_LANG', () => {
    expect(detectLang('es-MX', 'en')).toBe('es');
    expect(detectLang(undefined, 'es')).toBe('es');
    expect(detectLang('en', 'es')).toBe('en');
  });

  it('ignores dependencies, build output, dot-directories and simple .gitignore entries', () => {
    const ignored = createIgnorePolicy('# comment\n/reports/\n*.snap\n!keep.txt\nsrc/**/gen');
    for (const p of ['node_modules/x/index.js', '.git/HEAD', '.hexagen/state.json', 'dist/cli.js', 'reports/a.xml', 'a/b.snap', 'tsconfig.tsbuildinfo', 'debug.log']) {
      expect(ignored(p), p).toBe(true);
    }
    for (const p of ['src/index.ts', 'tests/unit/watch.test.ts', 'docs/rules/ui_conventions.md', 'package.json']) {
      expect(ignored(p), p).toBe(false);
    }
  });
});

describe('WatchService', () => {
  it('runs a baseline, debounces bursts, alerts on red/green, and survives a broken notifier', async () => {
    const h = harness([[result('typecheck', 'passed')], [result('typecheck', 'failed', 1, 'src/a.ts')], [result('typecheck', 'passed')]]);
    await h.service.start();
    expect(h.calls).toEqual([[]]);
    expect(h.voice.alerts).toHaveLength(0);
    expect(h.console.alerts.map((a) => a.kind)).toEqual(['baseline_ok']);

    for (const f of ['src/a.ts', 'src/a.ts', 'src/b.ts', 'node_modules/x.js', 'reports/r.xml']) h.change(f);
    await h.service.idle();
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1].sort()).toEqual(['src/a.ts', 'src/b.ts']);
    expect(h.voice.alerts.map((a) => a.spoken)).toEqual(['Se rompió el typecheck en a.']);
    expect(h.log.some((l) => l.includes('desktop notification failed: no display'))).toBe(true);

    h.change('src/a.ts');
    await h.service.idle();
    expect(h.voice.alerts.map((a) => a.kind)).toEqual(['broke', 'fixed']);
  });

  it('runs exactly once more when files change during a run, and nothing after stop', async () => {
    const h = harness([[result('test', 'passed')]], { slowMs: 60 });
    await h.service.start();
    h.change('src/a.ts');
    await new Promise((r) => setTimeout(r, 30)); // run #2 is in progress
    h.change('src/b.ts');
    h.change('src/c.ts');
    await h.service.idle();
    expect(h.calls).toHaveLength(3);
    expect(h.calls[2].sort()).toEqual(['src/b.ts', 'src/c.ts']);

    h.service.stop();
    expect(h.watcher.stopped).toBe(true);
    h.change('src/d.ts');
    await new Promise((r) => setTimeout(r, 40));
    expect(h.calls).toHaveLength(3);
  });

  it('logs checks that cannot run instead of crashing', async () => {
    const watcher = new FakeWatcher();
    const log: string[] = [];
    const service = new WatchService({ watcher, notifiers: [], isIgnored: () => false, lang: 'en', debounceMs: 5, log: (l) => log.push(l), run: async () => fail(new Error('boom')) });
    await service.start();
    expect(log).toContain('! checks could not run: boom');
  });
});

describe('notifiers', () => {
  it('pass alert text through the environment or argv, never inside a script', async () => {
    const spawned: { cmd: string; args: string[]; env?: Record<string, string> }[] = [];
    const run = async (cmd: string, args: string[], env?: Record<string, string>) => (spawned.push({ cmd, args, env }), true);
    const alert = toAlert({ kind: 'broke', result: result('typecheck', 'failed', 1, "src/$(rm -rf).ts") }, 'en');

    await new DesktopNotifier('win32', run).notify(alert);
    await new SpeechNotifier('es', 'win32', run).notify(alert);
    await new DesktopNotifier('darwin', run).notify(alert);
    await new SpeechNotifier('en', 'linux', run).notify(alert);

    expect(spawned[0].cmd).toBe('powershell.exe');
    expect(spawned[0].args.join(' ')).not.toContain('rm -rf');
    expect(spawned[0].env).toMatchObject({ HX_TITLE: alert.title, HX_BODY: alert.body });
    expect(spawned[1].env).toMatchObject({ HX_TEXT: alert.spoken, HX_LANG: 'es' });
    expect(spawned[2].args.slice(-2)).toEqual([alert.title, alert.body]);
    expect(spawned[3]).toMatchObject({ cmd: 'spd-say', args: ['-w', '-l', 'en', alert.spoken] });
  });

  it('report a missing notification or speech program as an error', async () => {
    const alert = toAlert({ kind: 'fixed', result: result('test', 'passed') }, 'en');
    await expect(new DesktopNotifier('linux', async () => false).notify(alert)).rejects.toThrow(/could not be shown/);
    await expect(new SpeechNotifier('en', 'linux', async () => false).notify(alert)).rejects.toThrow(/not available/);
  });
});

describe('session briefing', () => {
  it('tells the next session which failures watch mode saw', () => {
    const state: any = {
      metadata: { projectName: 'p', activeStacks: ['node'], version: '1', lastUpdated: '' },
      facts: [],
      plans: [],
      decisions: [],
      handoffs: [],
      qaHistory: [{ stack: 'node', check: 'typecheck', status: 'failed', failed: 2, total: 2, at: '2026-11-11T10:00:00Z', source: 'watch' }],
    };
    expect(buildBriefing(state, []).briefing).toContain('node/typecheck (2 failing, seen by watch mode at 2026-11-11T10:00:00Z)');
  });
});
