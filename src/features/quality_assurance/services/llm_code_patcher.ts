import * as path from 'node:path';
import { IFileSystem } from '../../../shared/infrastructure/file_system.js';
import { WorkspaceContext } from '../../../shared/infrastructure/workspace.js';
import { LlmClient } from '../../../shared/domain/llm_client.js';
import { ChangeJournal } from '../../../shared/infrastructure/change_journal.js';
import { QAResult } from '../domain/qa_types.js';
import { isTestFile } from '../domain/test_file_policy.js';
import { CodePatcher, PatchOutcome } from './qa_autonomous_loop.js';

interface ProposedEdit {
  file: string;
  search: string;
  replace: string;
}

const MAX_CONTEXT_FILES = 6;
const MAX_FILE_CHARS = 16_000;
const MAX_EDITS = 10;
const FORBIDDEN_SEGMENTS = /(^|[\\/])(\.git|\.hexagen|node_modules|vendor|target|_build|deps|dist|bin|obj)([\\/]|$)/;

const SYSTEM_PROMPT = `You fix failing code. Rules:
- Change implementation code only. Test files are READ-ONLY: they are the specification.
- Never weaken, skip or delete a test, and never special-case test inputs.
- Make the smallest change that makes the failing checks pass while respecting the architecture rules given.
- Respond with ONLY a JSON object: {"explanation": string, "edits": [{"file": string, "search": string, "replace": string}]}
- "file" is relative to the workspace root. "search" must be copied verbatim from the file and occur exactly once.
- If you cannot determine a safe fix, respond {"explanation": "<why>", "edits": []}.`;

/** Asks the connected model for a fix and applies it defensively through a rollback-able checkpoint. */
export class LlmCodePatcher implements CodePatcher {
  constructor(
    private readonly fileSystem: IFileSystem,
    private readonly workspace: WorkspaceContext,
    private readonly journal: ChangeJournal,
    private readonly llm: LlmClient
  ) {}

  async applyFix(failure: QAResult, context: { rules?: string; cwd?: string } = {}): Promise<PatchOutcome> {
    const baseDir = context.cwd ?? this.workspace.root;
    const files = await this.collectContextFiles(failure, baseDir);
    const prompt = this.buildPrompt(failure, files, context.rules);

    let raw: string;
    try {
      raw = await this.llm.complete({ system: SYSTEM_PROMPT, prompt, maxTokens: 4000 });
    } catch (error: any) {
      return { applied: false, summary: `Model request failed: ${error.message}` };
    }

    const proposal = this.parseProposal(raw);
    if (!proposal) return { applied: false, summary: 'Model response was not the required JSON edit format.' };
    if (proposal.edits.length === 0) return { applied: false, summary: `Model declined to patch: ${proposal.explanation}` };

    const validated: { absolute: string; content: string }[] = [];
    for (const edit of proposal.edits.slice(0, MAX_EDITS)) {
      const check = await this.validateEdit(edit, validated);
      if (typeof check === 'string') return { applied: false, summary: `Patch rejected: ${check}` };
      validated.push(check);
    }

    const checkpoint = await this.journal.begin(`auto-fix (${failure.check}): ${proposal.explanation.slice(0, 120)}`);
    for (const change of validated) {
      const written = await this.journal.write(checkpoint, change.absolute, change.content);
      if (written.isFailure) return { applied: false, summary: written.error.message, checkpointId: checkpoint.id };
    }
    return {
      applied: true,
      summary: proposal.explanation,
      checkpointId: checkpoint.id,
      files: validated.map((v) => this.workspace.relative(v.absolute)),
    };
  }

  private async collectContextFiles(failure: QAResult, baseDir: string): Promise<{ rel: string; content: string; readOnly: boolean }[]> {
    const seen = new Set<string>();
    const out: { rel: string; content: string; readOnly: boolean }[] = [];
    for (const f of failure.failures) {
      if (!f.file || out.length >= MAX_CONTEXT_FILES) continue;
      const absolute = path.isAbsolute(f.file) ? f.file : path.join(baseDir, f.file);
      const inside = this.workspace.resolveInside(absolute);
      if (inside.isFailure || seen.has(inside.value) || !(await this.fileSystem.exists(inside.value))) continue;
      seen.add(inside.value);
      const content = await this.fileSystem.readFile(inside.value);
      out.push({ rel: this.workspace.relative(inside.value), content: content.slice(0, MAX_FILE_CHARS), readOnly: isTestFile(inside.value) });
    }
    return out;
  }

  private buildPrompt(failure: QAResult, files: { rel: string; content: string; readOnly: boolean }[], rules?: string): string {
    const failures = failure.failures
      .slice(0, 15)
      .map((f) => `- ${f.file ?? '?'}${f.line ? `:${f.line}` : ''} ${f.testName ? `[${f.testName}] ` : ''}${f.errorMessage}`)
      .join('\n');
    const fileBlocks = files
      .map((f) => `### ${f.rel}${f.readOnly ? ' (READ-ONLY test file)' : ''}\n\`\`\`\n${f.content}\n\`\`\``)
      .join('\n\n');
    return [
      `Check "${failure.check}" failed for stack ${failure.stack} (${failure.command}).`,
      `Failures:\n${failures || '(none parsed)'}`,
      failure.rawStderr ? `stderr (tail):\n${failure.rawStderr.slice(-3000)}` : '',
      rules ? `Architecture rules to respect:\n${rules}` : '',
      fileBlocks ? `Relevant files:\n${fileBlocks}` : 'No source files could be located from the failure output.',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private parseProposal(raw: string): { explanation: string; edits: ProposedEdit[] } | undefined {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return undefined;
    try {
      const data = JSON.parse(raw.slice(start, end + 1));
      if (!Array.isArray(data.edits)) return undefined;
      const edits = data.edits.filter(
        (e: any) => e && typeof e.file === 'string' && typeof e.search === 'string' && typeof e.replace === 'string'
      );
      return { explanation: String(data.explanation ?? ''), edits };
    } catch {
      return undefined;
    }
  }

  /** Returns the new file content, or a rejection reason. Edits to the same file compose in order. */
  private async validateEdit(edit: ProposedEdit, pending: { absolute: string; content: string }[]): Promise<{ absolute: string; content: string } | string> {
    const inside = this.workspace.resolveInside(edit.file);
    if (inside.isFailure) return `'${edit.file}' is outside the workspace.`;
    const absolute = inside.value;
    if (FORBIDDEN_SEGMENTS.test(this.workspace.relative(absolute))) return `'${edit.file}' is in a protected directory.`;
    if (isTestFile(absolute)) return `'${edit.file}' is a test file; tests are the specification and are never auto-edited.`;

    const previous = pending.find((p) => p.absolute === absolute);
    const exists = previous !== undefined || (await this.fileSystem.exists(absolute));
    if (!exists) {
      if (edit.search !== '') return `'${edit.file}' does not exist.`;
      return { absolute, content: edit.replace };
    }
    const current = previous ? previous.content : await this.fileSystem.readFile(absolute);
    const occurrences = edit.search === '' ? 0 : current.split(edit.search).length - 1;
    if (occurrences !== 1) return `search block for '${edit.file}' matched ${occurrences} times (must match exactly once).`;
    if (previous) pending.splice(pending.indexOf(previous), 1);
    return { absolute, content: current.replace(edit.search, () => edit.replace) };
  }
}
