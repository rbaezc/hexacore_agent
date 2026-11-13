#!/usr/bin/env node
// End-to-end proof of watch mode and of the voice command loop, through the built CLI as users run it:
// `hexacore watch` sees a real file change break a real test run, alerts once, sees the fix, and
// records the runs for resume_session; `hexacore listen` answers typed commands (no microphone
// or whisper needed) and cancels a rollback on "no" without touching the files.
//
// Usage: npm run build && node scripts/e2e_watch.mjs [--keep]
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'dist', 'cli', 'hexacore_cli.js');
const keep = process.argv.includes('--keep');
const work = mkdtempSync(path.join(os.tmpdir(), 'hexacore-e2e-watch-'));
const env = { ...process.env, HEXACORE_HOME: path.join(work, 'home'), HEXACORE_PREVIEW: 'off', HEXACORE_LANG: 'en' };

function check(condition, message, detail) {
  if (!condition) throw new Error(`${message}${detail === undefined ? '' : `\n${detail}`}`);
  console.log(`  ok - ${message}`);
}

const SOURCE = path.join(work, 'src', 'sum.js');
const GOOD = 'module.exports = (a, b) => a + b;\n';
const BAD = 'module.exports = (a, b) => a - b;\n';

function project() {
  mkdirSync(path.join(work, 'src'), { recursive: true });
  writeFileSync(path.join(work, 'package.json'), JSON.stringify({ name: 'watch-e2e', version: '1.0.0', scripts: { test: 'node src/sum.test.js' } }, null, 2));
  writeFileSync(
    path.join(work, 'src', 'sum.test.js'),
    "const sum = require('./sum.js');\nif (sum(2, 2) !== 4) { console.error('src/sum.js:1 Error: sum(2, 2) returned ' + sum(2, 2)); process.exit(1); }\nconsole.log('1 passing');\n"
  );
  writeFileSync(SOURCE, GOOD);
}

/** Starts the CLI and lets the caller wait for lines on stderr. */
function start(args, stdin) {
  const child = spawn(process.execPath, [cli, ...args, '--workspace', work], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  const waiters = [];
  child.stderr.on('data', (d) => {
    out += d.toString();
    for (const w of [...waiters]) if (w.re.test(out)) (waiters.splice(waiters.indexOf(w), 1), w.resolve());
  });
  if (stdin !== undefined) child.stdin.end(stdin);
  const waitFor = (re, ms = 30000) =>
    new Promise((resolve, reject) => {
      if (re.test(out)) return resolve();
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${re}\n--- output ---\n${out}`)), ms);
      waiters.push({ re, resolve: () => (clearTimeout(timer), resolve()) });
    });
  const exited = new Promise((resolve) => child.on('exit', resolve));
  return { child, waitFor, exited, output: () => out };
}

const count = (text, re) => (text.match(new RegExp(re, 'g')) ?? []).length;
const children = [];

try {
  project();
  console.log(`=== watch → ${work}`);
  const watch = start(['watch', '--checks', 'test', '--notify', 'console', '--debounce', '300']);
  children.push(watch.child);
  await watch.waitFor(/Tests passing/);
  check(true, 'first run is green and says so');

  writeFileSync(SOURCE, BAD);
  await watch.waitFor(/Tests broke.*\n?.*sum\(2, 2\) returned 0/);
  check(true, 'a saved bug turns the check red, with the failure');

  // Ignored paths never trigger a run.
  const runsBefore = count(watch.output(), '↻');
  mkdirSync(path.join(work, 'node_modules', 'x'), { recursive: true });
  writeFileSync(path.join(work, 'node_modules', 'x', 'index.js'), '// noise');
  writeFileSync(path.join(work, 'debug.log'), 'noise');
  await new Promise((r) => setTimeout(r, 1200));
  check(count(watch.output(), '↻') === runsBefore, 'changes in node_modules and logs are ignored');

  writeFileSync(SOURCE, GOOD);
  await watch.waitFor(/Tests are green again/);
  check(count(watch.output(), 'Tests broke') === 1, 'one alert per colour change');
  watch.child.kill();
  await watch.exited;

  const state = JSON.parse(readFileSync(path.join(work, '.hexagen', 'state.json'), 'utf-8'));
  const runs = state.qaHistory.filter((q) => q.source === 'watch');
  check(runs.length === 3 && runs.map((r) => r.status).join() === 'passed,failed,passed', 'runs recorded for resume_session', JSON.stringify(state.qaHistory));

  console.log('=== listen (typed)');
  const listen = start(['listen', '--lang', 'es', '--mute'], 'hay algo roto\ncorre las pruebas\nrevierte el último cambio\nno\nsalir\n');
  children.push(listen.child);
  const code = await listen.exited;
  const out = listen.output();
  check(code === 0 && /Hasta luego\./.test(out), 'listen exits on "salir"', out);
  check(/Todo estaba en verde en la última corrida\./.test(out), 'reads the watch results back', out);
  check(/Las pruebas pasan\./.test(out), 'runs the tests on request', out);
  check(/No hay cambios que se puedan revertir\.|Cancelado, no cambié nada\./.test(out), 'never rolls back without a yes', out);
  check(readFileSync(SOURCE, 'utf-8') === GOOD, 'project files untouched');

  console.log('=== watch & voice: PASS');
} catch (error) {
  console.error('=== watch & voice: FAIL');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  for (const c of children) if (c.exitCode === null) c.kill();
  await new Promise((r) => setTimeout(r, 300));
  if (!keep) rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
