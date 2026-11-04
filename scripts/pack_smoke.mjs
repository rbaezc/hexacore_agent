#!/usr/bin/env node
// Proof that the published package works when installed, not just from the repo: npm pack, install
// the tarball into an empty project, then run the MCP smoke test against the installed launcher and
// require the installed CLI to find its bundled rules.
// Usage: npm run build && node scripts/pack_smoke.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(os.tmpdir(), 'hexacore-pack-'));

// npm through node, without a shell, the same way on Windows and Unix.
const npmCli = [
  process.env.npm_execpath,
  path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
  path.join(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
].find((p) => p && p.endsWith('.js') && existsSync(p));
if (!npmCli) throw new Error('npm-cli.js not found next to node');

// Keep the user's lesson library and profile (~/.hexacore) out of the test.
const isolated = { ...process.env, HEXACORE_HOME: path.join(work, 'home') };

function run(command, args, cwd, env = isolated) {
  const r = spawnSync(command, args, { cwd, env, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${r.status}):\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

try {
  // The MCP registry entry must describe the version being packed.
  const version = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf-8')).version;
  const server = JSON.parse(readFileSync(path.join(repo, 'server.json'), 'utf-8'));
  const mcpName = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf-8')).mcpName;
  if (server.version !== version || server.packages.some((p) => p.version !== version) || server.name !== mcpName) {
    throw new Error(`server.json (${server.name} ${server.version}) does not match package.json (${mcpName} ${version})`);
  }
  console.log(`  ok - server.json matches package.json (${version})`);

  const npm = (args, cwd) => run(process.execPath, [npmCli, ...args], cwd);
  const tarball = path.join(work, JSON.parse(npm(['pack', '--json', '--pack-destination', work], repo))[0].filename);
  console.log(`  ok - packed ${path.basename(tarball)}`);

  const app = path.join(work, 'app');
  mkdirSync(app);
  writeFileSync(path.join(app, 'package.json'), '{ "name": "pack-smoke", "private": true }\n');
  npm(['install', '--no-audit', '--no-fund', '--loglevel=error', tarball], app);
  console.log('  ok - installed into an empty project');

  const installed = path.join(app, 'node_modules', 'hexacore-agent');
  run(process.execPath, [path.join(repo, 'scripts/mcp_smoke.mjs')], repo, { ...isolated, HEXACORE_SMOKE_LAUNCHER: path.join(installed, 'dist/cli/mcp_launcher.js') });
  console.log('  ok - installed MCP server passes the stdio smoke test');

  const rag = JSON.parse(run(process.execPath, [path.join(installed, 'dist/cli/hexacore_cli.js'), 'rag', 'vertical slice layers', '--workspace', app], app));
  if (!rag.snippets?.some((s) => s.source === 'bundled')) throw new Error(`installed CLI found no bundled rules:\n${JSON.stringify(rag, null, 2)}`);
  console.log('  ok - installed CLI finds its bundled rules');
  console.log('=== pack smoke: PASS');
} catch (error) {
  console.error(`=== pack smoke: FAIL\n${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 3 });
}
