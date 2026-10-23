import { ParsedReport, TestFailureDetails } from '../../domain/qa_types.js';
import { emptyReport, firstLine } from './report_utils.js';

/** libtest output (`cargo test`): its line format has been stable for years, so text parsing is reliable here. */
export function parseCargoTest(output: string): ParsedReport | undefined {
  const summaries = [...output.matchAll(/test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored/g)];
  const compileErrors = parseRustcDiagnostics(output);
  if (summaries.length === 0 && compileErrors.length === 0) return undefined;

  const report = emptyReport('text');
  for (const s of summaries) {
    report.passed += Number(s[1]);
    report.failed += Number(s[2]);
    report.skipped += Number(s[3]);
  }
  report.total = report.passed + report.failed + report.skipped;

  for (const m of output.matchAll(/^test (\S+) \.\.\. FAILED$/gm)) {
    const name = m[1];
    const section = output.split(`---- ${name} stdout ----`)[1] ?? '';
    const panic = section.match(/panicked at ([^:\s]+):(\d+):\d+:\r?\n([^\r\n]*)/);
    report.failures.push({
      file: panic?.[1],
      line: panic ? Number(panic[2]) : undefined,
      testName: name,
      errorMessage: panic?.[3]?.trim() || firstLine(section) || 'Test failed',
    });
  }
  if (summaries.length === 0) {
    report.failed = compileErrors.length;
    report.failures.push(...compileErrors);
  }
  return report;
}

/** ExUnit (`mix test`) default formatter. */
export function parseMixTest(output: string): ParsedReport | undefined {
  const summary = output.match(/(\d+) (?:tests?|doctests?(?:, \d+ tests?)?), (\d+) failures?(?:, (\d+) (?:skipped|excluded|invalid))?/);
  // Elixir >= 1.20: "Result: 3/4 passed, 1 skipped" + "Failed: 1 test" (or just "Result: 4 passed").
  const modern = output.match(/^Result: (\d+)(?:\/(\d+))? passed(?:, (\d+) (?:skipped|excluded|invalid))?/m);
  const compileError = output.match(/\*\* \((CompileError|SyntaxError|TokenMissingError|UndefinedFunctionError|KeyError)\) ([^\r\n]*)/);
  if (!summary && !modern && !compileError) return undefined;

  const report = emptyReport('text');
  if (modern) {
    report.passed = Number(modern[1]);
    const ran = Number(modern[2] ?? modern[1]);
    report.skipped = Number(modern[3] ?? 0);
    report.failed = Number(output.match(/^Failed: (\d+) tests?/m)?.[1] ?? ran - report.passed);
    report.total = ran + report.skipped;
  } else if (summary) {
    // "2 doctests, 5 tests, 1 failure" — count every number before "failure".
    const counts = [...summary[0].matchAll(/(\d+) (?:doc)?tests?/g)].map((m) => Number(m[1]));
    report.total = counts.reduce((a, b) => a + b, 0);
    report.failed = Number(summary[2]);
    report.skipped = Number(summary[3] ?? 0);
    report.passed = Math.max(0, report.total - report.failed - report.skipped);
  }

  const blockRegex = /^\s+\d+\) test (.+?) \(([\w.]+)\)\r?\n\s+([^\s:]+\.exs?):(\d+)\r?\n([\s\S]*?)(?=^\s+\d+\) test |^Finished in|$(?![\s\S]))/gm;
  for (const m of output.matchAll(blockRegex)) {
    report.failures.push({
      file: m[3],
      line: Number(m[4]),
      testName: `${m[2]}: ${m[1]}`,
      errorMessage: firstLine(m[5]) || 'Test failed',
    });
  }

  if (compileError) {
    const location = output.match(/([\w/.-]+\.exs?):(\d+)/);
    report.failed = Math.max(report.failed, 1);
    report.failures.push({
      file: location?.[1],
      line: location ? Number(location[2]) : undefined,
      errorMessage: `${compileError[1]}: ${compileError[2]}`,
    });
  }
  return report;
}

/** rustc/cargo `--message-format short` and full diagnostics: `error[E0425]: ...` followed by `--> file:line:col`. */
export function parseRustcDiagnostics(output: string): TestFailureDetails[] {
  const failures: TestFailureDetails[] = [];
  for (const m of output.matchAll(/^(error|warning)(?:\[\w+\])?: (.+)\r?\n\s*--> ([^:\s]+):(\d+):\d+/gm)) {
    if (m[1] === 'warning') continue;
    failures.push({ file: m[3], line: Number(m[4]), errorMessage: m[2].trim() });
  }
  for (const m of output.matchAll(/^([^\s:]+\.rs):(\d+):\d+: (error|warning)(?:\[\w+\])?: (.+)$/gm)) {
    if (m[3] === 'warning') continue;
    failures.push({ file: m[1], line: Number(m[2]), errorMessage: m[4].trim() });
  }
  return failures;
}

/**
 * Compiler/linter diagnostics in the common shapes used by tsc, C#/MSBuild, go, mypy, ruff,
 * dart analyze, rubocop (emacs format), phpstan (raw), credo and mix compile.
 */
export function parseDiagnostics(output: string): TestFailureDetails[] {
  const seen = new Set<string>();
  const failures: TestFailureDetails[] = [];
  const push = (file: string, line: number, message: string) => {
    const key = `${file}:${line}:${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    failures.push({ file: file.trim(), line, errorMessage: message.trim() });
  };

  for (const line of output.split(/\r?\n/)) {
    // tsc / MSBuild: path(12,5): error TS2322: message  |  path(12,5): error CS0103: message [proj]
    let m = line.match(/^\s*(.+?)\((\d+),\d+\): (?:error|warning) ([A-Z]+\d+): (.+?)(?: \[.+\])?$/);
    if (m && !/warning/.test(line.split(m[3])[0])) {
      push(m[1], Number(m[2]), `${m[3]}: ${m[4]}`);
      continue;
    }
    // flutter/dart analyze: "  error - message - lib\x.dart:3:5 - code" (older SDKs separate with "•")
    m = line.match(/^\s*(error|warning|info) [•-] (.+) [•-] (\S+\.dart):(\d+):\d+ [•-] (\S+)\s*$/);
    if (m) {
      if (m[1] !== 'info') push(m[3], Number(m[4]), `${m[5]}: ${m[2]}`);
      continue;
    }
    // go vet / go build / mypy / ruff / rubocop(emacs) / phpstan(raw) / credo: path:line[:col]: message
    // (.rs is left to parseRustcDiagnostics, which understands rustc's own shapes.)
    m = line.match(/^\s*((?:[A-Za-z]:)?[\w./\\-]+\.(?:go|py|rb|php|ex|exs|ts|tsx|js|jsx|dart|cs)):(\d+)(?::\d+)?:\s*(.+)$/);
    if (m && !/^\s*(note|info):/i.test(m[3])) {
      push(m[1], Number(m[2]), m[3]);
    }
  }

  // Elixir warnings-as-errors / compile errors span lines: "error: message\n  └─ lib/x.ex:12:5"
  for (const m of output.matchAll(/(?:error|warning): ([^\r\n]+)\r?\n(?:[^\r\n]*\r?\n){0,6}?\s*└─ ([^\s:]+\.exs?):(\d+)/g)) {
    push(m[2], Number(m[3]), m[1]);
  }
  for (const f of parseRustcDiagnostics(output)) push(f.file!, f.line!, f.errorMessage);
  return failures;
}

/** Last resort when a runner offers no machine-readable output. */
export function heuristicParse(output: string): ParsedReport {
  const report = emptyReport('heuristic');
  const lines = output.split(/\r?\n/).filter((l) => /\b(FAIL(ED)?|AssertionError|Error:)/.test(l));
  for (const line of lines.slice(0, 20)) {
    const file = line.match(/[\w./\\-]+\.(?:ts|tsx|js|jsx|py|rs|go|rb|exs?|cs|dart|php)\b/)?.[0];
    report.failures.push({ file, errorMessage: line.trim().slice(0, 500) });
  }
  const summary = output.match(/Tests?:?\s+(?:(\d+) failed, )?(\d+) passed(?:, (\d+) total)?/i);
  if (summary) {
    report.failed = Number(summary[1] ?? 0);
    report.passed = Number(summary[2]);
    report.total = Number(summary[3] ?? report.failed + report.passed);
  } else {
    report.failed = report.failures.length;
    report.total = report.failed;
  }
  return report;
}
