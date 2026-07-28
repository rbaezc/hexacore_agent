import { ToolDefinition } from '../domain/mcp_types.js';
import { SupportedStack } from '../../state_management/domain/state_types.js';

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  getToolsForStacks(stacks: SupportedStack[]): ToolDefinition[] {
    const list: ToolDefinition[] = [];
    for (const tool of this.tools.values()) {
      if (!tool.supportedStacks || tool.supportedStacks.some((s) => stacks.includes(s))) {
        list.push(tool);
      }
    }
    return list;
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }
}
