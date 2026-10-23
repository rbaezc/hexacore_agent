import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  CallToolResult,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  RootsListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { HexaCoreServices } from '../../../composition_root.js';
import { Result } from '../../../shared/domain/result.js';
import { LlmClient } from '../../../shared/domain/llm_client.js';
import { ToolRegistry } from '../services/tool_registry.js';
import { PROMPTS } from './prompt_catalog.js';

export class HexaCoreMcpServer {
  readonly server: Server;

  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly services: HexaCoreServices,
    version: string
  ) {
    this.server = new Server(
      { name: 'HexaCore-Server', version },
      {
        capabilities: { tools: { listChanged: true }, resources: {}, prompts: {} },
        instructions:
          'HexaCore governs Vertical Slice Architecture across 11 stacks. Start every session with resume_session. ' +
          'Search rules (search_knowledge_base) before designing; preview scaffolds with dryRun; verify with run_quality_assurance and check_architecture; ' +
          'record design choices with record_decision and finish with record_handoff. All writes are checkpointed (rollback_changes).',
      }
    );
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.oninitialized = () => {
      void this.syncClientCapabilities();
    };
    this.server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
      await this.syncRoots();
      await this.server.sendToolListChanged().catch(() => undefined);
    });

    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const stacks = await this.services.stackDetector.detectActiveStacks(this.services.workspace.root);
      return { tools: this.toolRegistry.listTools(stacks) };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request, extra): Promise<CallToolResult> => {
      const progressToken = request.params._meta?.progressToken;
      let progress = 0;
      const ctx = {
        reportProgress: async (message: string) => {
          if (progressToken === undefined) return;
          progress += 1;
          await extra
            .sendNotification({ method: 'notifications/progress', params: { progressToken, progress, message } })
            .catch(() => undefined);
        },
      };
      const result = await this.toolRegistry.call(request.params.name, request.params.arguments, ctx);
      return toCallToolResult(result);
    });

    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const docs = await this.services.ragEngine.loadKnowledgeBase();
      return {
        resources: [
          { uri: 'hexacore://session/briefing', name: 'session-briefing', title: 'Session briefing', mimeType: 'application/json', description: 'Where work stopped (same as resume_session).' },
          ...docs.map((d) => ({
            uri: resourceUri(d.source, d.filePath),
            name: path.basename(d.filePath, '.md'),
            title: d.title,
            mimeType: 'text/markdown',
            description: `${d.source} knowledge: ${d.title}`,
          })),
        ],
      };
    });

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;
      if (uri === 'hexacore://session/briefing') {
        const result = await this.toolRegistry.call('resume_session', {}, { reportProgress: async () => undefined });
        const text = result.isSuccess ? JSON.stringify(result.value, null, 2) : result.error.message;
        return { contents: [{ uri, mimeType: 'application/json', text }] };
      }
      const doc = (await this.services.ragEngine.loadKnowledgeBase()).find((d) => resourceUri(d.source, d.filePath) === uri);
      if (!doc) throw new Error(`Unknown resource: ${uri}`);
      return { contents: [{ uri, mimeType: 'text/markdown', text: doc.content }] };
    });

    this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: PROMPTS.map(({ name, title, description, arguments: args }) => ({ name, title, description, arguments: args })),
    }));

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const prompt = PROMPTS.find((p) => p.name === request.params.name);
      if (!prompt) throw new Error(`Unknown prompt: ${request.params.name}`);
      const args = request.params.arguments ?? {};
      const missing = prompt.arguments.filter((a) => a.required && !args[a.name]).map((a) => a.name);
      if (missing.length) throw new Error(`Missing required argument(s): ${missing.join(', ')}`);
      return {
        description: prompt.description,
        messages: [{ role: 'user', content: { type: 'text', text: prompt.render(args) } }],
      };
    });
  }

  /** Adopts the client's workspace root and enables sampling-based auto-fix when supported. */
  private async syncClientCapabilities(): Promise<void> {
    const caps = this.server.getClientCapabilities();
    if (caps?.roots) await this.syncRoots();
    if (caps?.sampling) this.services.llm.client = new McpSamplingClient(this.server);
  }

  private async syncRoots(): Promise<void> {
    // An explicit HEXACORE_WORKSPACE always wins over what the client announces.
    if (process.env.HEXACORE_WORKSPACE) return;
    try {
      const { roots } = await this.server.listRoots();
      const first = roots.find((r) => r.uri.startsWith('file://'));
      if (first) this.services.workspace.setRoot(fileURLToPath(first.uri));
    } catch {
      // Client advertised roots but failed to answer: keep the current root.
    }
  }

  async start(): Promise<void> {
    await this.server.connect(new StdioServerTransport());
  }
}

/** LlmClient backed by MCP sampling: the connected client's own model answers, with its own approvals. */
export class McpSamplingClient implements LlmClient {
  constructor(private readonly server: Server) {}

  async complete(request: { system: string; prompt: string; maxTokens: number }): Promise<string> {
    const result = await this.server.createMessage({
      systemPrompt: request.system,
      maxTokens: request.maxTokens,
      includeContext: 'none',
      messages: [{ role: 'user', content: { type: 'text', text: request.prompt } }],
    });
    const content = Array.isArray(result.content) ? result.content : [result.content];
    return content.map((c: any) => (c.type === 'text' ? c.text : '')).join('');
  }
}

export function toCallToolResult(result: Result<unknown, Error>): CallToolResult {
  if (result.isFailure) {
    return { content: [{ type: 'text', text: result.error.message }], isError: true };
  }
  const value = result.value;
  const structured = value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : { result: value };
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: structured };
}

function resourceUri(source: string, filePath: string): string {
  return `hexacore://knowledge/${source}/${encodeURIComponent(path.basename(filePath))}`;
}
