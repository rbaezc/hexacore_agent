import { z } from 'zod';
import { Result } from '../../../shared/domain/result.js';
import { SupportedStack } from '../../../shared/domain/stack.js';

export interface ToolContext {
  /** Sends an MCP progress notification when the client asked for progress (no-op otherwise). */
  reportProgress(message: string): Promise<void>;
}

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  /**
   * Built per listing so stack enums can be narrowed to the stacks detected in the workspace
   * (fewer, more relevant choices for the model). Calls are validated against every stack.
   */
  schema: (stacks: readonly SupportedStack[]) => z.ZodObject<any>;
  annotations?: ToolAnnotations;
  handler: (args: any, ctx: ToolContext) => Promise<Result<unknown, Error>>;
}

export interface ListedTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown> & { type: 'object' };
  annotations?: ToolAnnotations;
}
