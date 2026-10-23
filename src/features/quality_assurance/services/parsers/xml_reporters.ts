import { ParsedReport } from '../../domain/qa_types.js';
import { decodeXmlEntities, emptyReport, firstLine, parseXmlAttributes } from './report_utils.js';

/**
 * JUnit XML (pytest `--junitxml`, PHPUnit/Pest `--log-junit`). A tiny purpose-built scanner:
 * the format is flat enough that pulling in an XML dependency isn't worth it.
 */
export function parseJUnitXml(xml: string): ParsedReport | undefined {
  if (!/<testsuites?\b/.test(xml)) return undefined;
  const report = emptyReport('junit');
  // pytest writes 0-based line numbers; PHPUnit/Pest write 1-based ones.
  const lineOffset = /<testsuite\b[^>]*name="pytest"/.test(xml) ? 1 : 0;

  const caseRegex = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  for (const m of xml.matchAll(caseRegex)) {
    const attrs = parseXmlAttributes(m[1]);
    const body = m[3] ?? '';
    report.total++;

    const problem = body.match(/<(failure|error)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/);
    if (problem) {
      report.failed++;
      const pAttrs = parseXmlAttributes(problem[2]);
      const text = decodeXmlEntities(problem[3] ?? '');
      report.failures.push({
        file: attrs.file,
        line: attrs.line ? Number(attrs.line) + lineOffset : undefined,
        testName: [attrs.classname, attrs.name].filter(Boolean).join('::'),
        errorMessage: firstLine(pAttrs.message) || firstLine(text) || problem[1],
      });
    } else if (/<skipped\b/.test(body)) {
      report.skipped++;
    } else {
      report.passed++;
    }
  }

  // Collection errors (pytest) show up as <error> on the suite with zero test cases.
  if (report.total === 0) {
    const suite = xml.match(/<testsuite\b([^>]*)>/);
    const errors = suite ? Number(parseXmlAttributes(suite[1]).errors ?? 0) : 0;
    if (errors > 0) {
      report.failed = errors;
      report.failures.push({ errorMessage: `${errors} collection/load error(s) before any test ran.` });
    }
  }
  return report;
}

/** Visual Studio TRX (`dotnet test --logger trx`). */
export function parseTrx(xml: string): ParsedReport | undefined {
  if (!/<TestRun\b/.test(xml)) return undefined;
  const report = emptyReport('trx');

  const resultRegex = /<UnitTestResult\b([^>]*?)(\/>|>([\s\S]*?)<\/UnitTestResult>)/g;
  for (const m of xml.matchAll(resultRegex)) {
    const attrs = parseXmlAttributes(m[1]);
    const body = m[3] ?? '';
    report.total++;
    const outcome = attrs.outcome ?? '';
    if (outcome === 'Passed') {
      report.passed++;
    } else if (outcome === 'NotExecuted' || outcome === 'Inconclusive') {
      report.skipped++;
    } else {
      report.failed++;
      const message = body.match(/<Message>([\s\S]*?)<\/Message>/)?.[1];
      const stack = decodeXmlEntities(body.match(/<StackTrace>([\s\S]*?)<\/StackTrace>/)?.[1] ?? '');
      const location = stack.match(/in (.+\.cs):line (\d+)/);
      report.failures.push({
        file: location?.[1],
        line: location ? Number(location[2]) : undefined,
        testName: attrs.testName,
        errorMessage: firstLine(decodeXmlEntities(message ?? '')) || `Test ${outcome}`,
      });
    }
  }
  return report;
}

/** Several projects may each emit a report; fold them into one. */
export function mergeReports(reports: ParsedReport[]): ParsedReport | undefined {
  if (reports.length === 0) return undefined;
  return reports.reduce((acc, r) => ({
    format: acc.format,
    total: acc.total + r.total,
    passed: acc.passed + r.passed,
    failed: acc.failed + r.failed,
    skipped: acc.skipped + r.skipped,
    failures: [...acc.failures, ...r.failures],
  }));
}
