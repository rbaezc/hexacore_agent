import { z } from 'zod';
import { Result, fail } from '../../../shared/domain/result.js';
import { ListedTool, ToolContext, ToolDefinition } from '../domain/mcp_types.js';
import { SUPPORTED_STACKS, SupportedStack } from '../../../shared/domain/stack.js';

/** Notified after every validated call (e.g. to learn the user's habits); must not throw. */
export type ToolCallObserver = (event: { tool: string; args: Record<string, unknown>; ok: boolean }) => Promise<void>;

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(private readonly observer?: ToolCallObserver) {}

  registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  /** Tool catalog with stack enums narrowed to `stacks` (all stacks when none were detected). */
  listTools(stacks: readonly SupportedStack[]): ListedTool[] {
    const offered = stacks.length > 0 ? stacks : SUPPORTED_STACKS;
    return [...this.tools.values()].map((tool) => {
      const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(tool.schema(offered), { io: 'input' }) as Record<string, unknown>;
      return {
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: { ...jsonSchema, type: 'object' },
        annotations: tool.annotations,
      };
    });
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** Validates arguments against the full schema, then runs the handler. */
  async call(name: string, rawArgs: unknown, ctx: ToolContext): Promise<Result<unknown, Error>> {
    const tool = this.tools.get(name);
    if (!tool) return fail(new Error(`Unknown tool '${name}'. Available: ${[...this.tools.keys()].join(', ')}.`));

    const parsed = tool.schema(SUPPORTED_STACKS).safeParse(rawArgs ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
      return fail(new Error(`Invalid arguments for '${name}': ${issues}`));
    }
    let result: Result<unknown, Error>;
    try {
      result = await tool.handler(parsed.data, ctx);
    } catch (error: any) {
      result = fail(new Error(`Tool '${name}' crashed: ${error?.message ?? String(error)}`));
    }
    await this.observer?.({ tool: name, args: parsed.data as Record<string, unknown>, ok: result.isSuccess }).catch(() => undefined);
    return result;
  }
}
