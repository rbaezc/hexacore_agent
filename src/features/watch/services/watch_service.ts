import { compareRuns, nextStatuses, summarizeRun } from '../domain/transitions.js';
import { toAlert } from '../domain/alert_text.js';
import { CheckRunner, FileWatcher, Notifier, Transition, WatchLang, WatchedStatus } from '../domain/watch_types.js';

export interface WatchServiceDeps {
  watcher: FileWatcher;
  run: CheckRunner;
  notifiers: Notifier[];
  isIgnored: (relPath: string) => boolean;
  lang: WatchLang;
  /** Quiet time after the last change before the checks run. */
  debounceMs: number;
  multiStack?: boolean;
  log?: (line: string) => void;
}

/**
 * Watches the workspace and re-runs the checks after each burst of changes.
 * Only one run happens at a time; changes made during a run cause exactly one more run.
 * Users are interrupted only when a check changes colour (see compareRuns).
 */
export class WatchService {
  private statuses = new Map<string, WatchedStatus>();
  private pending = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private rerun = false;
  private stopped = false;

  constructor(private readonly deps: WatchServiceDeps) {}

  /** Starts watching and runs a first time to learn the current state. */
  async start(): Promise<void> {
    this.stopped = false;
    this.deps.watcher.start((rel) => this.changed(rel));
    await this.flush();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.deps.watcher.stop();
  }

  /** Resolves once no run is in progress or scheduled (for tests and graceful shutdown). */
  async idle(): Promise<void> {
    while (this.running || this.timer) {
      if (this.running) await this.running;
      else await new Promise((r) => setTimeout(r, this.deps.debounceMs + 5));
    }
  }

  changed(relPath: string): void {
    if (this.stopped || this.deps.isIgnored(relPath)) return;
    this.pending.add(relPath);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.deps.debounceMs);
  }

  private flush(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.rerun = false;
          const changed = [...this.pending];
          this.pending.clear();
          await this.runOnce(changed);
        } while (this.rerun && !this.stopped);
      } finally {
        this.running = undefined;
      }
    })();
    return this.running;
  }

  /** One run: checks, transitions, alerts. Returns the transitions (handy for tests). */
  async runOnce(changed: string[]): Promise<Transition[]> {
    const log = this.deps.log ?? (() => undefined);
    const started = Date.now();
    if (changed.length) log(`↻ ${changed.length === 1 ? changed[0] : `${changed.length} files changed`}`);
    const results = await this.deps.run(changed);
    if (results.isFailure) {
      log(`! checks could not run: ${results.error.message}`);
      return [];
    }
    const transitions = compareRuns(this.statuses, results.value);
    this.statuses = nextStatuses(this.statuses, results.value);
    log(`${summarizeRun(results.value, Boolean(this.deps.multiStack))} (${((Date.now() - started) / 1000).toFixed(1)}s)`);

    for (const t of transitions) {
      const alert = toAlert(t, this.deps.lang, this.deps.multiStack);
      const targets = this.deps.notifiers.filter((n) => alert.important || n.verbose);
      await Promise.all(
        targets.map((n) => n.notify(alert).catch((error: Error) => log(`! ${n.name} notification failed: ${error.message}`)))
      );
    }
    return transitions;
  }
}
