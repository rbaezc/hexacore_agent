import * as path from 'node:path';
import { IFileSystem } from '../../../shared/infrastructure/file_system.js';
import { WorkspaceContext } from '../../../shared/infrastructure/workspace.js';
import { Result, ok, fail } from '../../../shared/domain/result.js';
import { ChangeJournal } from '../../../shared/infrastructure/change_journal.js';
import { StateRepository, DecisionRecord } from '../../state_management/index.js';
import { DecisionInput } from '../domain/design_types.js';

/**
 * Architecture Decision Records (Michael Nygard format) under docs/adr/. The RAG engine indexes
 * that folder, so every recorded decision becomes retrievable context for later work.
 */
export class DecisionRecorder {
  constructor(
    private readonly fileSystem: IFileSystem,
    private readonly workspace: WorkspaceContext,
    private readonly journal: ChangeJournal,
    private readonly stateRepo: StateRepository
  ) {}

  async record(input: DecisionInput): Promise<Result<DecisionRecord & { checkpointId: string }, Error>> {
    if (!input.title.trim() || !input.decision.trim()) return fail(new Error('A decision needs at least a title and the decision itself.'));

    const adrDir = path.join(this.workspace.root, 'docs', 'adr');
    const existing = await this.fileSystem.listDirectory(adrDir);
    const numbers = existing.map((f) => Number(path.basename(f).match(/^(\d{4})-/)?.[1] ?? 0));
    const number = Math.max(0, ...numbers) + 1;
    const slug = input.title
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60);
    const fileName = `${String(number).padStart(4, '0')}-${slug || 'decision'}.md`;
    const date = new Date().toISOString().slice(0, 10);
    const status = input.status ?? 'accepted';

    const content = [
      `# ${number}. ${input.title.trim()}`,
      '',
      `- **Status:** ${status}`,
      `- **Date:** ${date}`,
      input.tags?.length ? `- **Tags:** ${input.tags.join(', ')}` : '',
      '',
      '## Context',
      '',
      input.context.trim(),
      '',
      '## Decision',
      '',
      input.decision.trim(),
      '',
      input.alternatives?.length ? `## Alternatives Considered\n\n${input.alternatives.map((a) => `- ${a}`).join('\n')}\n` : '',
      '## Consequences',
      '',
      input.consequences.trim(),
      '',
    ]
      .filter((line, i, all) => !(line === '' && all[i - 1] === ''))
      .join('\n');

    const checkpoint = await this.journal.begin(`ADR ${number}: ${input.title}`);
    const written = await this.journal.write(checkpoint, path.join(adrDir, fileName), content);
    if (written.isFailure) return fail(written.error);

    const record: DecisionRecord = {
      id: `adr_${String(number).padStart(4, '0')}`,
      number,
      title: input.title.trim(),
      status,
      file: this.workspace.relative(written.value),
      date,
    };
    const saved = await this.stateRepo.addDecision(record);
    if (saved.isFailure) return fail(saved.error);
    return ok({ ...record, checkpointId: checkpoint.id });
  }
}
