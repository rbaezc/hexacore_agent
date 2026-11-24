import { z } from 'zod';
import { ok, fail } from '../../../../shared/domain/result.js';
import type { HexaCoreServices } from '../../../../composition_root.js';
import { ToolDefinition } from '../../domain/mcp_types.js';
import { AGENT_ROLES } from '../../../agents/index.js';

/** Agent roles: dev, qa and e2e as Claude Code subagents that share this project's HexaCore state. */
export function agentTools(s: HexaCoreServices): ToolDefinition[] {
  return [
    {
      name: 'export_agents',
      title: 'Export the dev, qa and e2e agent roles',
      description:
        'Writes HexaCore agent roles as Claude Code subagents in .claude/agents/hexacore-<role>.md: dev (design, scaffold, implement), qa (run checks, fix failures, lessons) and e2e (end-to-end and UI checks against a running app). ' +
        'Each role gets only the tools it needs and follows a handoff protocol through record_handoff. The user starts one by asking for it (or in its own terminal pane), and Claude Code delegates to it on its own when a task matches. ' +
        'Files edited by hand are left alone unless overwrite is set. Reversible through rollback_changes.',
      schema: () =>
        z.object({
          roles: z.array(z.enum(AGENT_ROLES)).optional().describe('Default: all roles'),
          serverName: z.string().optional().describe('Name HexaCore is registered under in the client (default hexacore-agent); it prefixes the MCP tool names'),
          overwrite: z.boolean().optional().describe('Replace files that were edited by hand'),
        }),
      handler: async (args: { roles?: string[]; serverName?: string; overwrite?: boolean }) => {
        const result = await s.agents.export(args);
        if (result.isFailure) return fail(result.error);
        const { exported } = result.value;
        return ok({
          ...result.value,
          nextActions: exported.length
            ? [
                'Restart the client session (or run /agents in Claude Code) so it loads the new subagents.',
                `Start one by asking for it, e.g. "use ${exported[0].name} to …", or let Claude delegate when a task matches.`,
                'Commit .claude/agents/ to share the roles with your team.',
              ]
            : [],
        });
      },
    },
  ];
}
