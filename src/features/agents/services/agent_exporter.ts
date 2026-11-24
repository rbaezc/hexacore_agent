import * as path from 'node:path';
import { IFileSystem } from '../../../shared/infrastructure/file_system.js';
import { WorkspaceContext } from '../../../shared/infrastructure/workspace.js';
import { ChangeJournal } from '../../../shared/infrastructure/change_journal.js';
import { Result, ok, fail } from '../../../shared/domain/result.js';
import { AGENT_ROLES, AgentExportResult, AgentRole, ExportedAgent } from '../domain/agent_types.js';
import { ROLES, isAgentRole } from '../domain/roles.js';
import { GENERATED_MARK, isValidServerName, renderAgentFile } from '../domain/agent_file.js';

export interface AgentExportOptions {
  /** Default: all roles. */
  roles?: string[];
  /** The name HexaCore is registered under in the client (default hexacore-agent). */
  serverName?: string;
  /** Replace files that were edited by hand. */
  overwrite?: boolean;
}

/** Writes the HexaCore roles as Claude Code subagents in .claude/agents/, through one checkpoint. */
export class AgentExporter {
  constructor(
    private readonly fileSystem: IFileSystem,
    private readonly workspace: WorkspaceContext,
    private readonly journal: ChangeJournal
  ) {}

  async export(options: AgentExportOptions = {}): Promise<Result<AgentExportResult, Error>> {
    const serverName = options.serverName ?? 'hexacore-agent';
    if (!isValidServerName(serverName)) return fail(new Error(`Invalid server name '${serverName}': letters, digits, '-' and '_' only.`));
    const unknown = (options.roles ?? []).filter((r) => !isAgentRole(r));
    if (unknown.length) return fail(new Error(`Unknown role(s): ${unknown.join(', ')}. Roles: ${AGENT_ROLES.join(', ')}.`));
    const roles = (options.roles?.length ? options.roles : [...AGENT_ROLES]) as AgentRole[];

    const skipped: string[] = [];
    const pending: { role: AgentRole; file: string; content: string }[] = [];
    for (const role of [...new Set(roles)]) {
      const def = ROLES[role];
      const file = path.join(this.workspace.root, '.claude', 'agents', `${def.name}.md`);
      const content = renderAgentFile(def, serverName);
      if (await this.fileSystem.exists(file)) {
        const current = await this.fileSystem.readFile(file);
        if (current === content) {
          skipped.push(`${def.name}: already up to date`);
          continue;
        }
        if (!current.includes(GENERATED_MARK) && !options.overwrite) {
          skipped.push(`${def.name}: edited by hand (pass overwrite to replace it)`);
          continue;
        }
      }
      pending.push({ role, file, content });
    }
    if (pending.length === 0) return ok({ exported: [], skipped });

    const checkpoint = await this.journal.begin(`Export HexaCore agent roles: ${pending.map((p) => p.role).join(', ')}`);
    const exported: ExportedAgent[] = [];
    for (const p of pending) {
      const written = await this.journal.write(checkpoint, p.file, p.content);
      if (written.isFailure) return fail(written.error);
      exported.push({ role: p.role, name: ROLES[p.role].name, file: this.workspace.relative(written.value) });
    }
    return ok({ exported, skipped, checkpointId: checkpoint.id });
  }
}
