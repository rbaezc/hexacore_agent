import { ParsedReport } from '../../domain/qa_types.js';
import { emptyReport } from './report_utils.js';

/** `eslint --format json`: one entry per file, severity 2 = error. Warnings don't fail the check. */
export function parseEslintJson(raw: string): ParsedReport | undefined {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(data)) return undefined;
  const report = emptyReport('json');
  for (const file of data) {
    report.total++;
    const errors = (file.messages ?? []).filter((m: any) => m.severity === 2);
    if (errors.length === 0) {
      report.passed++;
      continue;
    }
    report.failed++;
    for (const m of errors) {
      report.failures.push({ file: file.filePath, line: m.line, errorMessage: `${m.ruleId ?? 'eslint'}: ${m.message}` });
    }
  }
  return report;
}

/** `mix format --check-formatted` lists unformatted files as "  * path". */
export function parseMixFormat(output: string): ParsedReport | undefined {
  if (!/not formatted|--check-formatted/.test(output)) return undefined;
  const report = emptyReport('text');
  for (const m of output.matchAll(/^\s+\*\s+(\S+\.(?:ex|exs|heex))\s*$/gm)) {
    report.failures.push({ file: m[1], errorMessage: 'File is not formatted (run mix format).' });
  }
  report.failed = report.failures.length;
  report.total = report.failed;
  return report;
}
