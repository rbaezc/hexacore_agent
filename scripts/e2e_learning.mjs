#!/usr/bin/env node
// End-to-end proof of the learning loop on a real Go project, with the real `go test`:
// break a generated slice, fix it, and require HexaCore to turn that into an episode, a lesson,
// a suggestion when the bug comes back, credit backed by the actual fix (not mere correlation),
// a Claude Code skill, and a library lesson that a second project picks up.
//
// Runs in one process like the MCP server does, so red-state snapshots survive between QA runs.
// Usage: npm run build && node scripts/e2e_learning.mjs [--keep]
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => import(pathToFileURL(path.join(repo, 'dist', p)).href);
const { createHexaCore } = await load('composition_root.js');
const { createToolRegistry } = await load('features/mcp_server/infrastructure/mcp_server_factory.js');

const keep = process.argv.includes('--keep');
const work = mkdtempSync(path.join(os.tmpdir(), 'hexacore-e2e-learning-'));
const library = path.join(work, 'home');
const ctx = { reportProgress: async () => {} };
const GUARD = /\tif id == "" \{\n\t\treturn \w+\{\}, ErrMissingID\n\t\}\n/;

function check(condition, message, detail) {
  if (!condition) throw new Error(`${message}${detail === undefined ? '' : `\n${JSON.stringify(detail, null, 2)}`}`);
  console.log(`  ok - ${message}`);
}

/** A scaffolded Go project driven through HexaCore's tools, with the guard in its service breakable on demand. */
async function project(name, slice) {
  const dir = path.join(work, name);
  cpSync(path.join(repo, 'tests/e2e/fixtures/go'), dir, { recursive: true });
  const registry = createToolRegistry(createHexaCore({ workspaceRoot: dir, telemetryLog: false, lessonLibrary: library }));
  const call = async (tool, input = {}) => {
    const result = await registry.call(tool, input, ctx);
    if (result.isFailure) throw new Error(`${tool} failed: ${result.error.message}`);
    return result.value;
  };
  await call('execute_scaffolding', { stack: 'go', sliceName: slice });
  const service = path.join(dir, 'internal/slices', slice, 'service.go');
  const fixed = readFileSync(service, 'utf-8').replace(/\r\n/g, '\n');
  if (!GUARD.test(fixed)) throw new Error(`unexpected generated service:\n${fixed}`);
  return {
    call,
    qa: () => call('run_quality_assurance', { stack: 'go', checks: ['test'] }),
    breakIt: () => writeFileSync(service, fixed.replace(GUARD, '')),
    fixIt: () => writeFileSync(service, fixed),
    serviceFile: `internal/slices/${slice}/service.go`,
  };
}

const lesson = {
  title: 'Reject empty ids in Go slice services',
  problem: 'TestRejectsMissingID fails: Create accepts an empty id instead of returning ErrMissingID.',
  solution: 'In Service.Create, validate the id before saving: when id == "" return the zero entity and ErrMissingID. Keep the validation in the service, not in the handler.',
  example: 'if id == "" {\n\treturn OrdersEntity{}, ErrMissingID\n}',
};

async function main() {
  console.log(`=== learning loop → ${work}`);
  const shop = await project('shop', 'orders');
  check((await shop.qa()).passed, 'generated slice is green');

  // 1. Experience: red → green becomes an episode that knows what the fix changed.
  shop.breakIt();
  const red = await shop.qa();
  check(!red.passed && red.learning.suggestions.length === 0, 'broken guard is red, nothing learned yet', red.learning);
  shop.fixIt();
  const green = await shop.qa();
  const episode = green.learning.resolved[0];
  check(episode?.attribution === 'diff' && episode.changedFiles.includes(shop.serviceFile), 'episode records the fix', green.learning);
  check(green.nextActions.some((a) => a.includes(`record_lesson with episodeId '${episode.id}'`)), 'model is asked to distill it');

  // 2. Lesson, then offered and credited each time the bug recurs and the fix matches it.
  const { lesson: recorded } = await shop.call('record_lesson', { ...lesson, episodeId: episode.id });
  for (let i = 1; i <= 3; i++) {
    shop.breakIt();
    const again = await shop.qa();
    check(again.learning.suggestions[0]?.id === recorded.id, `recurrence ${i}: lesson suggested while red`, again.learning.suggestions);
    shop.fixIt();
    const resolved = (await shop.qa()).learning.resolved[0];
    check(resolved?.creditedLessonIds.includes(recorded.id) && resolved.attribution === 'diff', `recurrence ${i}: credited by the actual fix`, resolved);
  }
  const review = await shop.call('review_lessons');
  check(review.exportable.some((l) => l.id === recorded.id) && review.shareable.some((l) => l.id === recorded.id), 'lesson is proven (exportable and shareable)', review);

  // 3. Promotion: Claude Code skill, and the user's library.
  const exported = await shop.call('export_skills');
  check(existsSync(path.join(work, 'shop', exported.exported[0]?.file ?? '-')), 'exported as a Claude Code skill', exported);
  const shared = await shop.call('share_lessons');
  check(shared.shared.length === 1 && existsSync(shared.shared[0].file), 'shared with the lesson library', shared);

  // 4. Another project with the same stack benefits from it, and the evidence flows back to the library.
  const blog = await project('blog', 'posts');
  check((await blog.call('resume_session')).briefing.includes('Lesson library: 1 lesson(s)'), 'second project sees the library');
  blog.breakIt();
  const blogRed = await blog.qa();
  const libraryId = `library:${shared.shared[0].libraryId}`;
  check(blogRed.learning.suggestions[0]?.id === libraryId, 'library lesson suggested in the second project', blogRed.learning.suggestions);
  blog.fixIt();
  const blogGreen = await blog.qa();
  check(blogGreen.learning.resolved[0]?.creditedLessonIds.includes(libraryId), 'library lesson credited by the second project\'s fix', blogGreen.learning);
  const stats = JSON.parse(readFileSync(path.join(library, 'learning.json'), 'utf-8')).lessons[0];
  check(stats.projects.includes('blog') && stats.stats.helped === 4, 'library stats accumulate across projects', stats);
  console.log('=== learning loop: PASS');
}

try {
  await main();
} catch (error) {
  console.error(`=== learning loop: FAIL\n${error.message}`);
  process.exitCode = 1;
} finally {
  if (!keep) rmSync(work, { recursive: true, force: true, maxRetries: 3 });
}
