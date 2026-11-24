export const AGENT_ROLES = ['dev', 'qa', 'e2e'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

/** One HexaCore agent role, exported as a Claude Code subagent (.claude/agents/hexacore-<role>.md). */
export interface RoleDefinition {
  role: AgentRole;
  /** Subagent name, e.g. hexacore-qa. */
  name: string;
  /** What Claude Code matches tasks against to delegate on its own; also shown to the user. */
  description: string;
  /** HexaCore MCP tools the role may call (bare names, without the mcp__<server>__ prefix). */
  hexacoreTools: string[];
  /** Built-in client tools the role may use. */
  clientTools: string[];
  /** The subagent's system prompt (markdown). */
  instructions: string;
}

export interface ExportedAgent {
  role: AgentRole;
  name: string;
  file: string;
}

export interface AgentExportResult {
  exported: ExportedAgent[];
  /** Files left alone, with the reason (e.g. edited by hand; pass overwrite to replace them). */
  skipped: string[];
  checkpointId?: string;
}
