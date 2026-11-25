import { describe, it, expect } from 'vitest';
import { ok, fail } from '../../src/shared/domain/result.js';
import {
  Dispatcher,
  DispatchHandoff,
  DispatchPolicy,
  LaunchCommand,
  Transition,
  WatchedResult,
  buildLaunch,
  detectLauncher,
  dispatchHandoff,
  dispatchPrompt,
  parseDuration,
} from '../../src/features/watch/index.js';
import { parseDispatchFlags } from '../../src/cli/watch_command.js';

const MIN = 60_000;
const result = (check: string, status: WatchedResult['status'], failed = 0): WatchedResult => ({
  stack: 'node',
  check,
  status,
  failed,
  total: 10,
  failures: failed ? [{ file: 'src/a.ts', line: 3, testName: 'adds', errorMessage: "expected 2 to be 3\n  at a.test.ts:9; rm -rf $HOME" }] : [],
});
const t = (kind: Transition['kind'], check: string): Transition => ({ kind, result: result(check, kind === 'fixed' || kind === 'baseline_ok' ? 'passed' : 'failed', 2) });
const policy = (maxAgents = 1, sessionCap?: number) => new DispatchPolicy({ maxAgents, cooldownMs: 10 * MIN, sessionCap });

describe('dispatch policy', () => {
  it('starts one agent for checks that just broke, never for checks that stay red', () => {
    const p = policy();
    const first = p.plan([t('broke', 'test'), t('broke', 'typecheck')], 0);
    expect(first.dispatch?.keys).toEqual(['node:test', 'node:typecheck']);
    // The agent is editing: watch re-runs and the checks are still red.
    expect(p.plan([t('still_failing', 'test'), t('still_failing', 'typecheck')], MIN).dispatch).toBeUndefined();
    // test fixed, typecheck still red: the agent is still on it.
    const half = p.plan([t('fixed', 'test'), t('still_failing', 'typecheck')], 2 * MIN);
    expect(half.released).toEqual([]);
    expect(p.active[0].keys).toEqual(['node:typecheck']);
    const done = p.plan([t('fixed', 'typecheck')], 3 * MIN);
    expect(done.released[0]).toMatch(/done/);
    expect(p.active).toHaveLength(0);
  });

  it('caps agents in flight, gives up after the cooldown and waits for green before trying again', () => {
    const p = policy();
    expect(p.plan([t('baseline_failing', 'test')], 0).dispatch?.id).toBe(1);
    const busy = p.plan([t('fixed', 'test'), t('broke', 'lint')], MIN);
    // test went green, so agent 1 is done and lint can get agent 2.
    expect(busy.dispatch?.keys).toEqual(['node:lint']);
    const capped = p.plan([t('broke', 'typecheck')], 2 * MIN);
    expect(capped.dispatch).toBeUndefined();
    expect(capped.skipped[0]).toMatch(/already running \(maxAgents 1\)/);

    const timedOut = p.plan([], 12 * MIN);
    expect(timedOut.released[0]).toMatch(/timed out on node:lint/);
    // lint flips red again later: blocked until it has passed once.
    expect(p.plan([t('broke', 'lint')], 13 * MIN).skipped[0]).toMatch(/waiting for it to pass once/);
    p.plan([t('fixed', 'lint')], 14 * MIN);
    expect(p.plan([t('broke', 'lint')], 15 * MIN).dispatch?.keys).toEqual(['node:lint']);
  });

  it('releases an agent that reported back, and stops at the session cap', () => {
    const p = policy(5, 2);
    const a = p.plan([t('broke', 'test')], 0).dispatch!;
    expect(p.release(a.id, 'reported back')).toBe('agent #1 reported back');
    p.plan([t('broke', 'lint')], MIN);
    expect(p.plan([t('broke', 'typecheck')], 2 * MIN).skipped[0]).toMatch(/already started 2 agents/);
  });

  it('parses durations', () => {
    expect([parseDuration('10m'), parseDuration('90s'), parseDuration('1.5h'), parseDuration('2500'), parseDuration('soon')]).toEqual([600_000, 90_000, 5_400_000, 2500, undefined]);
  });
});

describe('dispatch text and launch commands', () => {
  const d = policy().plan([t('broke', 'test')], 0).dispatch!;

  it('hands the failure over in the handoff and keeps the prompt to a safe alphabet', () => {
    const h = dispatchHandoff(d);
    expect(h.summary).toBe('Watch mode: node/test (2 failing). Over to qa.');
    expect(h.nextSteps[0]).toBe('node/test: src/a.ts:3 "adds" — expected 2 to be 3');
    const bare = { ...d, transitions: [{ kind: 'broke' as const, result: { ...result('test', 'failed', 1), failures: [{ errorMessage: 'AssertionError: -1 == 3' }] } }] };
    expect(dispatchHandoff(bare).nextSteps[0]).toBe('node/test: AssertionError: -1 == 3');
    const prompt = dispatchPrompt(d, 'qa');
    expect(prompt).toContain('node/test');
    expect(prompt).not.toMatch(/[;$'"`&|<>]/);
  });

  const req = { role: 'qa', agentName: 'hexacore-qa', prompt: dispatchPrompt(d, 'qa'), cwd: 'C:\\work\\shop' };

  it('opens a Windows Terminal pane running claude with the role set', () => {
    const c = buildLaunch('wt', req)!;
    expect(c.cmd).toBe('wt');
    expect(c.args.slice(0, 7)).toEqual(['-w', '0', 'split-pane', '-V', '-d', 'C:\\work\\shop', '--title']);
    expect(c.args.join(' ')).not.toContain(';');
    const script = Buffer.from(c.args.at(-1)!, 'base64').toString('utf16le');
    expect(script).toBe(`$env:HEXACORE_AGENT='qa'\nclaude --agent hexacore-qa '${req.prompt}'`);
  });

  it('builds tmux and template commands, and prints for print', () => {
    expect(buildLaunch('tmux', req)!.args).toEqual(['split-window', '-h', '-c', 'C:\\work\\shop', '-e', 'HEXACORE_AGENT=qa', `claude --agent hexacore-qa '${req.prompt}'`]);
    const tpl = buildLaunch('herdr pane run --cwd {cwd} -- {command}', req)!;
    expect(tpl).toEqual({ cmd: `herdr pane run --cwd C:\\work\\shop -- claude --agent hexacore-qa "${req.prompt}"`, args: [], shell: true });
    expect(buildLaunch('print', req)).toBeUndefined();
  });

  it('detects the terminal and validates the flags', () => {
    expect(detectLauncher({ TMUX: '/tmp/x' })).toBe('tmux');
    expect(detectLauncher({ WT_SESSION: 'abc' })).toBe('wt');
    expect(detectLauncher({})).toBe('print');
    expect(parseDispatchFlags({})).toBeUndefined();
    expect(parseDispatchFlags({ dispatch: true }, { WT_SESSION: 'x' })).toEqual({ role: 'qa', launcher: 'wt', maxAgents: 1, cooldownMs: 600_000 });
    expect(parseDispatchFlags({ dispatch: 'qa', launcher: 'tmux', maxAgents: '2', cooldown: '5m' })).toMatchObject({ maxAgents: 2, cooldownMs: 300_000 });
    expect(() => parseDispatchFlags({ dispatch: 'ops' })).toThrow(/dispatch qa/);
    expect(() => parseDispatchFlags({ dispatch: true, launcher: 'konsole' })).toThrow(/Unknown launcher/);
    expect(() => parseDispatchFlags({ dispatch: true, maxAgents: '0' })).toThrow(/maxAgents/);
  });
});

describe('Dispatcher', () => {
  function setup(launcher = 'wt', launchOk = true) {
    const log: string[] = [];
    const handoffs: DispatchHandoff[] = [];
    const launched: LaunchCommand[] = [];
    let reported = false;
    let clock = 0;
    const dispatcher = new Dispatcher({
      policy: policy(),
      role: 'qa',
      launcher,
      cwd: '/ws',
      log: (l) => log.push(l),
      now: () => clock,
      recordHandoff: async (h) => void handoffs.push(h),
      reportedSince: async () => reported,
      launch: async (c, _cwd, env) => {
        expect(env).toEqual({ HEXACORE_AGENT: 'qa' });
        launched.push(c);
        return launchOk ? ok(undefined) : fail(new Error('wt not found'));
      },
    });
    return { dispatcher, log, handoffs, launched, report: () => (reported = true), tick: (ms: number) => (clock += ms) };
  }

  it('records the handoff before opening the agent, and frees the slot when the agent reports back', async () => {
    const s = setup();
    await s.dispatcher.afterRun([t('broke', 'test')]);
    expect(s.handoffs).toHaveLength(1);
    expect(s.launched[0].cmd).toBe('wt');
    expect(s.log.at(-1)).toMatch(/agent #1 \(hexacore-qa\) started for node:test with wt/);

    await s.dispatcher.afterRun([t('broke', 'lint')]);
    expect(s.launched).toHaveLength(1);
    s.report();
    s.tick(MIN);
    await s.dispatcher.afterRun([t('broke', 'lint')]);
    expect(s.log.some((l) => l.includes('reported back with a handoff'))).toBe(true);
    expect(s.launched).toHaveLength(2);
  });

  it('only prints the command with the print launcher or when the terminal cannot be opened', async () => {
    const printed = setup('print');
    await printed.dispatcher.afterRun([t('broke', 'test')]);
    expect(printed.launched).toHaveLength(0);
    expect(printed.handoffs).toHaveLength(1);
    expect(printed.log.at(-1)).toMatch(/Start the agent with: claude --agent hexacore-qa "/);

    const broken = setup('wt', false);
    await broken.dispatcher.afterRun([t('broke', 'test')]);
    expect(broken.log.at(-1)).toMatch(/could not open the qa agent with wt \(wt not found\)\. Start it with: claude --agent/);
  });
});
