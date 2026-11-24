import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { AgentExporter, ROLES, renderAgentFile, GENERATED_MARK } from '../../src/features/agents/index.js';
import { ChangeJournal } from '../../src/shared/infrastructure/change_journal.js';
import { WorkspaceContext } from '../../src/shared/infrastructure/workspace.js';
import { InMemoryFileSystem } from '../helpers/in_memory_fs.js';

const ROOT = path.resolve('/ws');
const agentFile = (name: string) => path.join(ROOT, '.claude', 'agents', `${name}.md`);

function setup() {
  const fs = new InMemoryFileSystem();
  const workspace = new WorkspaceContext(ROOT);
  const journal = new ChangeJournal(fs, workspace);
  return { fs, journal, exporter: new AgentExporter(fs, workspace, journal) };
}

function frontmatter(content: string): Record<string, string> {
  const block = content.split('---')[1];
  return Object.fromEntries(block.trim().split('\n').map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
}

describe('agent roles', () => {
  it('render as Claude Code subagents with prefixed MCP tool names', () => {
    const fm = frontmatter(renderAgentFile(ROLES.qa, 'hexacore-agent'));
    expect(fm.name).toBe('hexacore-qa');
    expect(JSON.parse(fm.description)).toBe(ROLES.qa.description);
    const tools = fm.tools.split(', ');
    expect(tools).toContain('mcp__hexacore-agent__run_quality_assurance');
    expect(tools).toContain('Edit');
  });

  it('keep each role inside its boundaries', () => {
    const tools = (role: keyof typeof ROLES) => [...ROLES[role].hexacoreTools, ...ROLES[role].clientTools];
    expect(tools('qa')).not.toContain('execute_scaffolding');
    expect(tools('qa')).not.toContain('orchestrate_task');
    expect(tools('e2e')).not.toContain('Edit');
    expect(tools('e2e')).not.toContain('Write');
    expect(tools('dev')).toContain('execute_scaffolding');
    for (const def of Object.values(ROLES)) {
      expect(def.hexacoreTools).toContain('resume_session');
      expect(def.hexacoreTools).toContain('record_handoff');
      expect(def.instructions).toContain(`agent: "${def.role}"`);
    }
  });
});

describe('AgentExporter', () => {
  it('writes every role through one checkpoint, and rollback removes them', async () => {
    const { fs, journal, exporter } = setup();
    const res = await exporter.export();
    expect(res.isSuccess).toBe(true);
    if (!res.isSuccess) return;
    expect(res.value.exported.map((e) => e.file)).toEqual(['.claude/agents/hexacore-dev.md', '.claude/agents/hexacore-qa.md', '.claude/agents/hexacore-e2e.md']);
    expect(await fs.readFile(agentFile('hexacore-dev'))).toContain(GENERATED_MARK);

    await journal.rollback(res.value.checkpointId!);
    expect(await fs.exists(path.join(ROOT, '.claude'))).toBe(false);
  });

  it('uses the server name the client registered HexaCore under', async () => {
    const { fs, exporter } = setup();
    await exporter.export({ roles: ['e2e'], serverName: 'hexacore' });
    expect(await fs.readFile(agentFile('hexacore-e2e'))).toContain('mcp__hexacore__run_quality_assurance');
    expect(await fs.exists(agentFile('hexacore-dev'))).toBe(false);
  });

  it('skips files that are up to date, refreshes generated ones and keeps hand-edited ones', async () => {
    const { fs, exporter } = setup();
    await exporter.export();
    const again = await exporter.export();
    expect(again.isSuccess && again.value.exported).toEqual([]);

    await fs.writeFile(agentFile('hexacore-dev'), (await fs.readFile(agentFile('hexacore-dev'))).replace('hexacore-agent__', 'old__'));
    await fs.writeFile(agentFile('hexacore-qa'), '---\nname: hexacore-qa\n---\nmy own prompt');
    const refreshed = await exporter.export();
    expect(refreshed.isSuccess && refreshed.value.exported.map((e) => e.role)).toEqual(['dev']);
    expect(refreshed.isSuccess && refreshed.value.skipped.some((s) => /hexacore-qa: edited by hand/.test(s))).toBe(true);
    expect(await fs.readFile(agentFile('hexacore-qa'))).toContain('my own prompt');

    const forced = await exporter.export({ roles: ['qa'], overwrite: true });
    expect(forced.isSuccess && forced.value.exported.map((e) => e.role)).toEqual(['qa']);
  });

  it('rejects unknown roles and invalid server names', async () => {
    const { exporter } = setup();
    expect((await exporter.export({ roles: ['ops'] })).isFailure).toBe(true);
    expect((await exporter.export({ serverName: 'bad name' })).isFailure).toBe(true);
  });
});
