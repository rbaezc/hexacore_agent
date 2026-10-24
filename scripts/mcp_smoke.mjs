#!/usr/bin/env node
// Smoke test of the built MCP server over real stdio, the way Claude Code / Cursor launch it.
// Requires `npm run build` first.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = mkdtempSync(path.join(os.tmpdir(), 'hexacore-mcp-smoke-'));
writeFileSync(path.join(workspace, 'go.mod'), 'module example.com/smoke\n\ngo 1.22\n');

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(repo, 'dist/cli/mcp_launcher.js')],
  cwd: workspace,
  stderr: 'inherit',
});
const client = new Client({ name: 'hexacore-smoke', version: '1.0.0' });

function assert(condition, message) {
  if (!condition) throw new Error(`smoke check failed: ${message}`);
  console.log(`  ok - ${message}`);
}

try {
  await client.connect(transport);
  const info = client.getServerVersion();
  assert(info?.name === 'HexaCore-Server', `handshake with ${info?.name} v${info?.version}`);

  const { tools } = await client.listTools();
  assert(tools.length >= 12, `${tools.length} tools listed`);
  const scaffold = tools.find((t) => t.name === 'execute_scaffolding');
  assert(JSON.stringify(scaffold.inputSchema.properties.stack.enum) === '["go"]', 'stack enum narrowed to the detected stack (go)');

  const session = await client.callTool({ name: 'resume_session', arguments: {} });
  assert(!session.isError && session.structuredContent.workspace.stacks[0].stack === 'go', 'resume_session sees the workspace');

  const rules = await client.callTool({ name: 'search_knowledge_base', arguments: { query: 'reglas de capas en go' } });
  assert(!rules.isError && rules.structuredContent.snippets.length > 0, `bundled rules found from a foreign workspace (${rules.structuredContent.snippets[0]?.heading})`);

  const dry = await client.callTool({ name: 'execute_scaffolding', arguments: { stack: 'go', sliceName: 'orders', dryRun: true } });
  assert(!dry.isError && dry.structuredContent.plannedFiles.length === 6, 'dry-run scaffold plans 6 files');

  const bad = await client.callTool({ name: 'rollback_changes', arguments: {} });
  assert(bad.isError === true, 'invalid arguments are reported with isError');

  const { resources } = await client.listResources();
  assert(resources.some((r) => r.uri.startsWith('hexacore://knowledge/bundled/')), `${resources.length} resources exposed`);

  const { prompts } = await client.listPrompts();
  assert(prompts.length === 3, 'guided prompts exposed');
  console.log('MCP smoke test passed.');
} finally {
  await client.close().catch(() => undefined);
  rmSync(workspace, { recursive: true, force: true, maxRetries: 3 });
}
