import type { HexaCoreServices } from '../../../composition_root.js';
import { ToolRegistry } from '../services/tool_registry.js';
import { coreTools } from './tools/core_tools.js';
import { workflowTools } from './tools/workflow_tools.js';
import { learningTools } from './tools/learning_tools.js';
import { profileTools } from './tools/profile_tools.js';

export function createToolRegistry(services: HexaCoreServices): ToolRegistry {
  const registry = new ToolRegistry((event) => services.profile.observe(event));
  for (const tool of [...coreTools(services), ...workflowTools(services), ...learningTools(services), ...profileTools(services)]) registry.registerTool(tool);
  return registry;
}
