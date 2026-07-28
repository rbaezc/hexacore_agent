import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ToolRegistry } from '../services/tool_registry.js';
import { StackDetector } from './stack_detector.js';

export class HexaCoreMcpServer {
  private readonly server: Server;

  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly stackDetector: StackDetector
  ) {
    this.server = new Server(
      {
        name: 'HexaCore-Server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const activeStacks = await this.stackDetector.detectActiveStacks();
      const tools = this.toolRegistry.getToolsForStacks(activeStacks);

      return {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const tool = this.toolRegistry.getTool(request.params.name);
      if (!tool) {
        throw new Error(`Tool not found: ${request.params.name}`);
      }

      return await tool.handler(request.params.arguments);
    });
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}
