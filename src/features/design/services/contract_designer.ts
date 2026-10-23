import * as path from 'node:path';
import { WorkspaceContext } from '../../../shared/infrastructure/workspace.js';
import { Result, ok, fail } from '../../../shared/domain/result.js';
import { ChangeJournal } from '../../../shared/infrastructure/change_journal.js';
import { deriveSliceNames } from '../../../shared/domain/slice_names.js';
import { ContractField, ContractInput, ContractOperation } from '../domain/design_types.js';

const TYPE_MAP: Record<ContractField['type'], string[]> = {
  string: ['type: string'],
  integer: ['type: integer'],
  number: ['type: number'],
  boolean: ['type: boolean'],
  datetime: ['type: string', 'format: date-time'],
};

/** Contract-first design: an OpenAPI 3.1 document per slice, written before (and guiding) the code. */
export class ContractDesigner {
  constructor(
    private readonly workspace: WorkspaceContext,
    private readonly journal: ChangeJournal
  ) {}

  async define(input: ContractInput): Promise<Result<{ file: string; checkpointId: string; yaml: string }, Error>> {
    const names = deriveSliceNames(input.sliceName);
    if (names.isFailure) return fail(names.error);
    if (input.operations.length === 0) return fail(new Error('A contract needs at least one operation.'));

    const n = names.value;
    const yaml = this.render(input, n.pascal, n.kebab);
    const file = path.join(input.outputDir ?? 'contracts', `${n.snake}.openapi.yaml`);
    const checkpoint = await this.journal.begin(`contract for slice '${n.snake}'`);
    const written = await this.journal.write(checkpoint, file, yaml);
    if (written.isFailure) return fail(written.error);
    return ok({ file: this.workspace.relative(written.value), checkpointId: checkpoint.id, yaml });
  }

  private render(input: ContractInput, pascal: string, kebab: string): string {
    const out: string[] = [
      'openapi: 3.1.0',
      'info:',
      `  title: ${quote(input.title ?? `${pascal} API`)}`,
      `  version: ${quote(input.version ?? '1.0.0')}`,
      'paths:',
    ];

    const byPath = new Map<string, ContractOperation[]>();
    for (const op of input.operations) {
      const suffix = op.path === '/' || op.path === '' ? '' : `/${op.path.replace(/^\//, '')}`;
      const fullPath = `/${kebab}${suffix}`;
      byPath.set(fullPath, [...(byPath.get(fullPath) ?? []), op]);
    }

    const schemas: string[] = [];
    for (const [fullPath, ops] of byPath) {
      out.push(`  ${quote(fullPath)}:`);
      const params = [...fullPath.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      for (const op of ops) {
        const opId = `${op.method.toLowerCase()}${pascal}${params.length ? 'By' + params.map(cap).join('And') : ''}`;
        out.push(`    ${op.method.toLowerCase()}:`, `      operationId: ${opId}`, `      summary: ${quote(op.summary)}`);
        if (params.length) {
          out.push('      parameters:');
          for (const p of params) out.push(`        - name: ${p}`, '          in: path', '          required: true', '          schema:', '            type: string');
        }
        if (op.request?.length) {
          const schema = `${cap(opId)}Request`;
          schemas.push(...this.schema(schema, op.request));
          out.push('      requestBody:', '        required: true', '        content:', '          application/json:', '            schema:', `              $ref: '#/components/schemas/${schema}'`);
        }
        const status = op.successStatus ?? (op.method === 'POST' ? 201 : 200);
        out.push('      responses:', `        '${status}':`, `          description: ${quote(op.summary)}`);
        if (op.response?.length) {
          const schema = `${cap(opId)}Response`;
          schemas.push(...this.schema(schema, op.response));
          out.push('          content:', '            application/json:', '              schema:', `                $ref: '#/components/schemas/${schema}'`);
        }
        out.push("        '400':", '          description: Invalid input');
        if (params.length) out.push("        '404':", '          description: Not found');
      }
    }

    if (schemas.length) out.push('components:', '  schemas:', ...schemas);
    return `${out.join('\n')}\n`;
  }

  private schema(name: string, fields: ContractField[]): string[] {
    const required = fields.filter((f) => f.required !== false).map((f) => f.name);
    const lines = [`    ${name}:`, '      type: object'];
    if (required.length) lines.push('      required:', ...required.map((r) => `        - ${r}`));
    lines.push('      properties:');
    for (const f of fields) {
      lines.push(`        ${f.name}:`, ...TYPE_MAP[f.type].map((t) => `          ${t}`));
      if (f.description) lines.push(`          description: ${quote(f.description)}`);
    }
    return lines;
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** YAML double-quoted scalar: safe for any user-provided text. */
function quote(s: string): string {
  return JSON.stringify(s);
}
