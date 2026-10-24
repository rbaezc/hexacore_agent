import { ParsedReport, TestFailureDetails } from '../../domain/qa_types.js';
import { firstLine, emptyReport } from './report_utils.js';

/** Vitest's `--reporter=json` and Jest's `--json` share this (Jest-compatible) shape. */
export function parseJestLikeJson(raw: string): ParsedReport | undefined {
  const data = extractJson(raw);
  if (!data || !Array.isArray(data.testResults)) return undefined;

  const failures: TestFailureDetails[] = [];
  for (const suite of data.testResults) {
    const assertions: any[] = suite.assertionResults ?? [];
    for (const a of assertions) {
      if (a.status !== 'failed') continue;
      failures.push({
        file: suite.name ?? suite.testFilePath,
        line: a.location?.line,
        testName: a.fullName ?? a.title,
        errorMessage: firstLine((a.failureMessages ?? []).join('\n')) || 'Assertion failed',
      });
    }
    // A suite that fails to load (syntax/import error) has no assertions, only a message.
    if (assertions.length === 0 && suite.status === 'failed') {
      failures.push({ file: suite.name, errorMessage: firstLine(suite.message) || 'Test suite failed to run' });
    }
  }

  const loadErrors = failures.filter((f) => !f.testName).length;
  return {
    format: 'json',
    total: data.numTotalTests ?? 0,
    passed: data.numPassedTests ?? 0,
    failed: (data.numFailedTests ?? 0) + loadErrors,
    skipped: (data.numPendingTests ?? 0) + (data.numTodoTests ?? 0),
    failures,
  };
}

/** `go test -json` emits one event per line. */
export function parseGoTestJson(raw: string): ParsedReport | undefined {
  const report = emptyReport('json');
  const outputByTest = new Map<string, string[]>();
  let sawEvent = false;
  const buildErrors: string[] = [];
  const failedPackages = new Set<string>();

  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('{')) {
      // Compile errors are printed as plain text before any JSON event.
      if (/\.go:\d+:\d+:/.test(line)) buildErrors.push(line.trim());
      continue;
    }
    let ev: any;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    sawEvent = true;
    if (!ev.Test) {
      // Go >= 1.24 reports compiler output as `build-output` events.
      if ((ev.Action === 'output' || ev.Action === 'build-output') && /\.go:\d+:\d+:/.test(ev.Output ?? '')) {
        buildErrors.push(ev.Output.trim());
      } else if (ev.Action === 'fail' && ev.Package) {
        failedPackages.add(ev.Package);
      }
      continue;
    }
    const key = `${ev.Package}/${ev.Test}`;
    if (ev.Action === 'output') {
      const list = outputByTest.get(key) ?? [];
      list.push(ev.Output);
      outputByTest.set(key, list);
    } else if (ev.Action === 'pass') {
      report.total++;
      report.passed++;
    } else if (ev.Action === 'skip') {
      report.total++;
      report.skipped++;
    } else if (ev.Action === 'fail') {
      report.total++;
      report.failed++;
      const output = (outputByTest.get(key) ?? []).join('');
      const location = output.match(/(\w+_test\.go):(\d+):\s*(.*)/);
      report.failures.push({
        file: location?.[1],
        line: location ? Number(location[2]) : undefined,
        testName: ev.Test,
        errorMessage: location?.[3]?.trim() || firstLine(output) || 'Test failed',
      });
    }
  }

  for (const err of buildErrors) {
    const m = err.match(/([^\s:]+\.go):(\d+):\d+:\s*(.*)/);
    report.failures.push({ file: m?.[1], line: m ? Number(m[2]) : undefined, errorMessage: m?.[3] ?? err });
    report.failed++;
  }
  // A package can fail with no failing test (init panic, TestMain exit); never report that as green.
  if (report.failures.length === 0) {
    for (const pkg of failedPackages) {
      report.failures.push({ errorMessage: `Package ${pkg} failed without a failing test (build error, panic in init or TestMain).` });
      report.failed++;
    }
  }
  return sawEvent || buildErrors.length > 0 ? report : undefined;
}

/** `flutter test --reporter json` emits one event per line (testStart / error / testDone). */
export function parseFlutterJson(raw: string): ParsedReport | undefined {
  const report = emptyReport('json');
  const tests = new Map<number, { name: string; url?: string; line?: number; error?: string }>();
  let sawEvent = false;

  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('{')) continue;
    let ev: any;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    sawEvent = true;
    if (ev.type === 'testStart') {
      tests.set(ev.test.id, { name: ev.test.name, url: ev.test.root_url ?? ev.test.url, line: ev.test.root_line ?? ev.test.line });
    } else if (ev.type === 'error') {
      const t = tests.get(ev.testID);
      if (t) t.error = firstLine(ev.error);
    } else if (ev.type === 'testDone') {
      const t = tests.get(ev.testID);
      // Flutter reports synthetic "loading <file>" tests; hidden ones aren't real tests.
      if (!t || ev.hidden) {
        if (t && ev.result !== 'success') {
          report.failed++;
          report.failures.push({ file: t.url?.replace(/^file:\/\/\/?/, ''), errorMessage: t.error ?? 'Test file failed to load' });
        }
        continue;
      }
      report.total++;
      if (ev.skipped) report.skipped++;
      else if (ev.result === 'success') report.passed++;
      else {
        report.failed++;
        report.failures.push({
          file: t.url?.replace(/^file:\/\/\/?/, ''),
          line: t.line,
          testName: t.name,
          errorMessage: t.error ?? 'Test failed',
        });
      }
    }
  }
  return sawEvent ? report : undefined;
}

/** `rspec --format json`. */
export function parseRspecJson(raw: string): ParsedReport | undefined {
  const data = extractJson(raw);
  if (!data || !Array.isArray(data.examples)) return undefined;
  const failures: TestFailureDetails[] = data.examples
    .filter((e: any) => e.status === 'failed')
    .map((e: any) => ({
      file: e.file_path?.replace(/^\.\//, ''),
      line: e.line_number,
      testName: e.full_description,
      errorMessage: firstLine(e.exception?.message) || 'Example failed',
    }));
  const errorsOutside = data.summary?.errors_outside_of_examples_count ?? 0;
  if (errorsOutside > 0) {
    failures.push({ errorMessage: `${errorsOutside} error(s) occurred outside of examples (load/syntax error).` });
  }
  return {
    format: 'json',
    total: data.summary?.example_count ?? data.examples.length,
    passed: data.examples.filter((e: any) => e.status === 'passed').length,
    failed: (data.summary?.failure_count ?? failures.length) + errorsOutside,
    skipped: data.summary?.pending_count ?? 0,
    failures,
  };
}

/** Reporters sometimes print banners/logs around the JSON document; find the outermost object. */
function extractJson(raw: string): any {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) return undefined;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}
