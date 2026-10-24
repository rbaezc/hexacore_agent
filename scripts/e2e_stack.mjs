#!/usr/bin/env node
// End-to-end proof that generated slices are real code: for each stack, copy a minimal host
// project, scaffold two slices with the HexaCore CLI, then require the stack's own compiler
// and test runner (driven through HexaCore's QA tool) to pass, and the architecture audit to be clean.
//
// Usage: node scripts/e2e_stack.mjs <stack|all> [--keep]
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const SLICES = ['orders', 'user-profile'];

/** setup: shell commands run in the copied project; checks: QA checks that must pass; minTests: across both slices. */
const STACKS = {
  node: { setup: ['npm install --no-audit --no-fund --loglevel=error --legacy-peer-deps'], checks: ['typecheck', 'test'], minTests: 4 },
  react: { setup: ['npm install --no-audit --no-fund --loglevel=error --legacy-peer-deps'], checks: ['typecheck', 'test'], minTests: 4 },
  reactnative: { setup: ['npm install --no-audit --no-fund --loglevel=error --legacy-peer-deps'], checks: ['typecheck', 'test'], minTests: 4 },
  python: { setup: ['python -m venv .venv', `${venvBin('python')} -m pip install -q fastapi pydantic pytest`], checks: ['build', 'test'], minTests: 4, venv: true },
  go: { setup: [], checks: ['build', 'lint', 'test'], minTests: 4 },
  rust: { setup: [], checks: ['typecheck', 'test'], minTests: 4 },
  dotnet: {
    setup: ['dotnet new sln -n Shop --format sln', 'dotnet sln Shop.sln add src/Shop.Api/Shop.Api.csproj tests/Shop.Tests/Shop.Tests.csproj'],
    checks: ['build', 'test'],
    minTests: 4,
  },
  laravel: { setup: ['composer install --no-interaction --no-progress --quiet'], checks: ['test'], minTests: 4, syntax: ['php', '-l'], ext: '.php' },
  ruby: { setup: ['bundle config set --local path vendor/bundle', 'bundle install --quiet'], checks: ['test'], minTests: 4, syntax: ['ruby', '-c'], ext: '.rb' },
  elixir: { setup: [], checks: ['build', 'test'], minTests: 4 },
  flutter: { setup: ['flutter pub get'], checks: ['typecheck', 'test'], minTests: 4 },
};

function venvBin(exe) {
  return isWin ? `.venv\\Scripts\\${exe}` : `.venv/bin/${exe}`;
}

function sh(command, cwd, env) {
  const r = spawnSync(command, { cwd, env, shell: true, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`setup command failed (${r.status}): ${command}`);
}

function hexacore(args, workspace, env) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', path.join(repo, 'src/cli/hexacore_cli.ts'), ...args, '--workspace', workspace], {
    cwd: repo,
    env,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });
  let json;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    json = undefined;
  }
  return { code: r.status, json, stderr: r.stderr, stdout: r.stdout };
}

function filesUnder(dir, ext) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (['node_modules', 'vendor', '.venv', 'target', '_build', 'bin', 'obj'].includes(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full, ext));
    else if (full.endsWith(ext)) out.push(full);
  }
  return out;
}

function runStack(stack, keep) {
  const spec = STACKS[stack];
  if (!spec) throw new Error(`Unknown stack '${stack}'. Known: ${Object.keys(STACKS).join(', ')}`);
  const work = mkdtempSync(path.join(os.tmpdir(), `hexacore-e2e-${stack}-`));
  cpSync(path.join(repo, 'tests/e2e/fixtures', stack), work, { recursive: true });
  console.log(`\n=== ${stack} → ${work}`);

  const env = { ...process.env };
  if (spec.venv) env.PATH = `${path.join(work, isWin ? '.venv/Scripts' : '.venv/bin')}${path.delimiter}${env.PATH}`;

  try {
    for (const command of spec.setup) sh(command, work, env);

    for (const slice of SLICES) {
      const r = hexacore(['scaffold', stack, slice], work, env);
      if (r.code !== 0) throw new Error(`scaffold ${slice} failed:\n${r.stderr}\n${r.stdout}`);
      console.log(`  scaffolded ${slice}: ${r.json.createdFiles.length} files`);
    }

    if (spec.syntax) {
      for (const file of filesUnder(path.join(work, 'app'), spec.ext)) {
        const [cmd, ...args] = spec.syntax;
        const r = spawnSync(cmd, [...args, file], { encoding: 'utf-8' });
        if (r.status !== 0) throw new Error(`syntax check failed for ${file}:\n${r.stdout}${r.stderr}`);
      }
      console.log('  syntax check: ok');
    }

    const qa = hexacore(['qa', stack, '--checks', spec.checks.join(',')], work, env);
    if (!qa.json) throw new Error(`qa produced no JSON (exit ${qa.code}):\n${qa.stderr}\n${qa.stdout}`);
    for (const result of qa.json.results) {
      console.log(`  ${result.check}: ${result.status} (${result.passedTests}/${result.totalTests}, ${result.reportFormat}) — ${result.command}`);
      if (result.status !== 'passed') {
        throw new Error(`${result.check} ${result.status}: ${result.skipReason ?? JSON.stringify(result.failures, null, 2)}\n${result.rawStdout}\n${result.rawStderr}`);
      }
    }
    const test = qa.json.results.find((r) => r.check === 'test');
    if (test && test.totalTests < spec.minTests) throw new Error(`expected at least ${spec.minTests} tests, runner reported ${test.totalTests}`);

    const arch = hexacore(['arch'], work, env);
    if (!arch.json?.passed) throw new Error(`architecture check failed:\n${JSON.stringify(arch.json?.violations ?? arch.stderr, null, 2)}`);
    console.log(`  architecture: ${arch.json.errorCount} errors, ${arch.json.warningCount} warnings (${arch.json.filesScanned} files)`);
    console.log(`=== ${stack}: PASS`);
  } finally {
    if (!keep) rmSync(work, { recursive: true, force: true, maxRetries: 3 });
  }
}

const [target = 'all', ...flags] = process.argv.slice(2);
const keep = flags.includes('--keep');
const stacks = target === 'all' ? Object.keys(STACKS) : target.split(',');
const failures = [];
for (const stack of stacks) {
  try {
    runStack(stack, keep);
  } catch (error) {
    console.error(`=== ${stack}: FAIL\n${error.message}`);
    failures.push(stack);
  }
}
if (failures.length) {
  console.error(`\nFailed stacks: ${failures.join(', ')}`);
  process.exit(1);
}
console.log(`\nAll ${stacks.length} stack(s) passed.`);
