import { SupportedStack } from '../../state_management/domain/state_types.js';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
  supportedStacks?: SupportedStack[];
  handler: (args: any) => Promise<{ content: { type: string; text: string }[] }>;
}
