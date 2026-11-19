#!/usr/bin/env node
// End-to-end proof of UI prototyping with a real browser (Playwright + Chromium) and the real
// preview server: a prototype that only breaks on a phone is caught by the rendered ui check,
// fixed, learned from, the lesson is offered and credited when another prototype repeats the
// mistake, and the approved page is promoted into the project and audited there.
//
// Runs in one process like the MCP server does, so red-state snapshots survive between checks.
// Usage: npm run build && npx playwright install chromium && node scripts/e2e_ui.mjs [--keep]
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => import(pathToFileURL(path.join(repo, 'dist', p)).href);
const { createHexaCore } = await load('composition_root.js');
const { createToolRegistry } = await load('features/mcp_server/infrastructure/mcp_server_factory.js');
const { attachedImages } = await load('shared/domain/attachments.js');

const keep = process.argv.includes('--keep');
const work = mkdtempSync(path.join(os.tmpdir(), 'hexacore-e2e-ui-'));
const home = path.join(work, 'home');
const ctx = { reportProgress: async () => {} };

const FIXED_COLUMNS = 'grid-template-columns: repeat(4, 220px);';
const FLUID_COLUMNS = 'grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));';

function check(condition, message, detail) {
  if (!condition) throw new Error(`${message}${detail === undefined ? '' : `\n${JSON.stringify(detail, null, 2)}`}`);
  console.log(`  ok - ${message}`);
}

/** A page that passes every static rule but scrolls sideways on a phone: only the browser can tell. */
function page(title) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { --bg: #f6f5f2; --fg: #1c1b19; --line: #e3e0d9; }
  @media (prefers-color-scheme: dark) { :root { --bg: #111013; --fg: #ece9e3; --line: #2a282d; color-scheme: dark; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 system-ui, sans-serif; }
  main { padding: 24px 16px; }
  .cards { display: grid; gap: 12px; ${FIXED_COLUMNS} }
  .card { border: 1px solid var(--line); border-radius: 8px; padding: 16px; }
</style>
</head>
<body>
<main>
  <h1>${title}</h1>
  <div class="cards">
    <div class="card">Node.js</div><div class="card">Go</div><div class="card">Rust</div><div class="card">Elixir</div>
  </div>
</main>
</body>
</html>`;
}

async function main() {
  console.log(`=== ui prototyping → ${work}`);
  writeFileSync(path.join(work, 'package.json'), JSON.stringify({ name: 'site', private: true }));
  const services = createHexaCore({ workspaceRoot: work, telemetryLog: false, lessonLibrary: home, userProfile: path.join(home, 'profile.json'), preview: { port: 0 } });
  const registry = createToolRegistry(services);
  const raw = async (tool, input = {}) => {
    const result = await registry.call(tool, input, ctx);
    if (result.isFailure) throw new Error(`${tool} failed: ${result.error.message}`);
    return result;
  };
  const call = async (tool, input) => (await raw(tool, input)).value;
  const ui = (target) => raw('run_quality_assurance', { stack: 'node', checks: ['ui'], target });

  try {
    // 1. A prototype, served locally.
    const created = await call('create_prototype', { name: 'landing', html: page('Stacks'), target: 'site/index.html' });
    check(created.staticAudit.passed, 'prototype passes the static rules', created.staticAudit);
    const served = await (await fetch(created.previewUrl)).text();
    check(served.includes('<h1>Stacks</h1>') && served.includes('/__rev/landing'), `served with live reload at ${created.previewUrl}`);

    // 2. The browser catches what the source can't: it scrolls sideways at 390px.
    const redCall = await ui('landing');
    const red = redCall.value.results[0];
    const overflow = red.failures.find((f) => f.testName.startsWith('ui/overflow (mobile'));
    check(red.status === 'failed' && overflow?.errorMessage.includes('cards'), 'rendered check finds the phone overflow', red);
    check(!red.failures.some((f) => f.testName.includes('desktop')), 'desktop is fine', red.failures);
    check(red.artifacts.length === 4 && red.artifacts.every((a) => existsSync(path.join(work, a))), '4 screenshots written (phone/desktop × light/dark)', red.artifacts);
    check(attachedImages(redCall.value).length === 2, 'two screenshots attached for the model to look at');

    // 3. Fix → green → an episode that knows what changed.
    await call('create_prototype', { name: 'landing', edits: [{ oldText: FIXED_COLUMNS, newText: FLUID_COLUMNS }], note: 'fluid columns' });
    const green = (await ui('landing')).value;
    const episode = green.learning.resolved[0];
    check(green.passed && episode?.attribution === 'diff' && episode.changedFiles.includes('.hexagen/prototypes/landing/index.html'), 'fixed version is green and the fix is recorded', green);

    // 4. The lesson comes back when another prototype repeats the mistake, and the fix earns it credit.
    const { lesson } = await call('record_lesson', {
      episodeId: episode.id,
      title: 'Card grids must wrap at phone width',
      problem: 'ui/overflow on mobile: a grid with fixed column widths (repeat(4, 220px)) is wider than a 390px screen.',
      solution: 'Use grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)) so the columns wrap instead of scrolling sideways.',
      example: FLUID_COLUMNS,
    });
    await call('create_prototype', { name: 'pricing', html: page('Pricing') });
    const again = (await ui('pricing')).value;
    check(again.learning.suggestions[0]?.id === lesson.id, 'lesson suggested for the second prototype', again.learning.suggestions);
    await call('create_prototype', { name: 'pricing', edits: [{ oldText: FIXED_COLUMNS, newText: FLUID_COLUMNS }] });
    const credited = (await ui('pricing')).value.learning.resolved[0];
    check(credited?.creditedLessonIds.includes(lesson.id), 'lesson credited by the actual fix', credited);

    // 5. Promote the approved version into the project, audited where it lands.
    mkdirSync(path.join(work, 'site'), { recursive: true });
    const promoted = await call('promote_prototype', { name: 'landing', target: 'site/index.html' });
    check(promoted.mode === 'copied' && readFileSync(path.join(work, 'site/index.html'), 'utf-8').includes(FLUID_COLUMNS), 'approved version promoted to site/index.html');
    check(promoted.audit.status === 'passed' && promoted.audit.command.includes('static + browser'), 'promoted page passes the ui check in place', promoted.audit);
    console.log('=== ui prototyping: PASS');
  } finally {
    await services.prototypes.preview.stop();
  }
}

try {
  await main();
} catch (error) {
  console.error(`=== ui prototyping: FAIL\n${error.message}`);
  process.exitCode = 1;
} finally {
  if (!keep) rmSync(work, { recursive: true, force: true, maxRetries: 3 });
}
