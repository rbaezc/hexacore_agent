import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CreateMessageRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createToolRegistry } from '../../src/features/mcp_server/infrastructure/mcp_server_factory.js';
import { HexaCoreMcpServer } from '../../src/features/mcp_server/infrastructure/mcp_stdio_server.js';
import { createTestHexaCore } from '../helpers/test_hexacore.js';

async function connect(options: { sampling?: (prompt: string) => string; testFailures?: number[] } = {}) {
  const { services, fs } = createTestHexaCore(options.testFailures ?? [0]);
  const server = new HexaCoreMcpServer(createToolRegistry(services), services, 'test');
  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: options.sampling ? { sampling: {} } : {} });
  if (options.sampling) {
    client.setRequestHandler(CreateMessageRequestSchema, async (request) => {
      const content = request.params.messages[0].content as { type: string; text: string };
      return { role: 'assistant', model: 'test-model', content: { type: 'text', text: options.sampling!(content.text) } };
    });
  }
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.server.connect(serverTransport), client.connect(clientTransport)]);
  // oninitialized fires asynchronously; give capability sync a tick.
  await new Promise((r) => setTimeout(r, 20));
  return { client, services, fs };
}

describe('HexaCore MCP server (real client over in-memory transport)', () => {
  it('lists tools with JSON schemas, narrowing stack enums to the detected stacks', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['resume_session', 'execute_scaffolding', 'run_quality_assurance', 'check_architecture', 'orchestrate_task', 'resume_plan', 'rollback_changes', 'record_decision', 'define_contract', 'record_handoff']));

    const scaffold = tools.find((t) => t.name === 'execute_scaffolding')!;
    expect((scaffold.inputSchema.properties as any).stack.enum).toEqual(['node']);
    expect(scaffold.inputSchema.required).toEqual(['stack', 'sliceName']);
  });

  it('returns isError with a precise message for invalid arguments', async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: 'execute_scaffolding', arguments: { stack: 'cobol', sliceName: 'x' } });
    expect(res.isError).toBe(true);
    expect((res.content as any)[0].text).toContain('stack');
  });

  it('returns structuredContent for successful calls and isError for domain failures', async () => {
    const { client } = await connect();
    const briefing = await client.callTool({ name: 'resume_session', arguments: {} });
    expect(briefing.isError).toBeFalsy();
    expect((briefing.structuredContent as any).workspace.stacks).toEqual([{ stack: 'node', dir: '.' }]);

    const first = await client.callTool({ name: 'execute_scaffolding', arguments: { stack: 'node', sliceName: 'orders' } });
    expect(first.isError).toBeFalsy();
    const again = await client.callTool({ name: 'execute_scaffolding', arguments: { stack: 'node', sliceName: 'orders' } });
    expect(again.isError).toBe(true);
    expect((again.content as any)[0].text).toContain('Refusing to overwrite');
  });

  it('exposes bundled rules as resources and guided workflows as prompts', async () => {
    const { client } = await connect();
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain('hexacore://session/briefing');

    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(['design_feature', 'implement_slice', 'fix_failing_checks']);
    const prompt = await client.getPrompt({ name: 'design_feature', arguments: { requirement: 'Refunds' } });
    expect((prompt.messages[0].content as any).text).toContain('Refunds');
  });

  it('auto-fixes failing tests through the client model via MCP sampling', async () => {
    let sawPrompt = '';
    const { client } = await connect({
      testFailures: [1, 0],
      sampling: (prompt) => {
        sawPrompt = prompt;
        return JSON.stringify({ explanation: 'trim ids', edits: [{ file: 'src/features/orders/application/orders_handler.ts', search: 'if (!input.id) {', replace: 'if (!input.id.trim()) {' }] });
      },
    });
    const res = await client.callTool({ name: 'orchestrate_task', arguments: { description: 'Orders', targetStack: 'node', sliceName: 'orders' } });
    expect(res.isError).toBeFalsy();
    const value = res.structuredContent as any;
    expect(value.success).toBe(true);
    expect(value.qaAttempts.map((a: any) => a.status)).toEqual(['failed', 'patched', 'passed']);
    expect(sawPrompt).toContain('Check "test" failed');
  });
});
