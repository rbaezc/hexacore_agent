import * as os from 'node:os';
import * as path from 'node:path';
import { IProcessRunner, ProcessExecutionResult } from '../../../shared/infrastructure/process_runner.js';
import { IFileSystem, NodeFileSystem } from '../../../shared/infrastructure/file_system.js';
import { Result, ok, fail } from '../../../shared/domain/result.js';
import { ParsedReport, QACheck, QARunnerOptions, QAResult } from '../domain/qa_types.js';
import { CheckCatalog, CheckInvocation, Executable } from './check_catalog.js';
import { heuristicParse, parseDiagnostics } from './parsers/text_reporters.js';
import { firstLine, tail } from './parsers/report_utils.js';

export class QARunnerService {
  private readonly catalog: CheckCatalog;

  constructor(
    private readonly processRunner: IProcessRunner,
    private readonly fileSystem: IFileSystem = new NodeFileSystem()
  ) {
    this.catalog = new CheckCatalog(fileSystem);
  }

  /** Runs the stack's test suite. */
  async runQA(options: QARunnerOptions): Promise<Result<QAResult, Error>> {
    return this.runCheck(options, 'test');
  }

  /** Runs several checks in order; stops early only on infrastructure errors (not on red results). */
  async runChecks(options: QARunnerOptions, checks: QACheck[]): Promise<Result<QAResult[], Error>> {
    const results: QAResult[] = [];
    for (const check of checks) {
      const res = await this.runCheck(options, check);
      if (res.isFailure) return fail(res.error);
      results.push(res.value);
    }
    return ok(results);
  }

  async runCheck(options: QARunnerOptions, check: QACheck): Promise<Result<QAResult, Error>> {
    const cwd = options.cwd || process.cwd();
    // Scope tokens become literal argv entries; no shell ever interprets them.
    const scope = options.scope ? options.scope.trim().split(/\s+/).filter(Boolean) : [];
    const reportDir = path.join(os.tmpdir(), `hexacore-${check}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);

    try {
      const planned = await this.catalog.plan(options.stack, check, cwd, scope, reportDir);
      if ('skip' in planned) return ok(this.skipped(options, check, planned.skip, ''));

      await this.fileSystem.ensureDir(reportDir);
      const { execution, used } = await this.execute(planned.invocation, cwd, `${options.stack}:${check}`, options.onOutput);
      const command = used ? [used.cmd, ...used.args].join(' ') : planned.invocation.candidates[0].cmd;

      if (execution.failureKind === 'not_found') {
        return ok(this.skipped(options, check, `'${planned.invocation.candidates.map((c) => c.cmd).join("' / '")}' is not installed or not on PATH.`, command));
      }
      if (execution.failureKind && execution.failureKind !== 'exit_code') {
        return fail(new Error(`QA ${check} could not run (${execution.failureKind}): ${firstLine(execution.stderr) || 'no output'}`));
      }

      const output = `${execution.stdout}\n${execution.stderr}`;
      const missingTool = planned.invocation.missingToolPattern;
      if (!execution.success && missingTool?.test(output)) {
        const evidence = output.split(/\r?\n/).find((l) => missingTool.test(l));
        return ok(this.skipped(options, check, `Tool for '${check}' is not installed in this project: ${firstLine(evidence)}`, command));
      }

      const reportContents = await this.readReports(planned.invocation);
      const report = this.toReport(check, planned.invocation, output, reportContents);
      return ok(this.finalize(options, check, command, execution, report));
    } catch (error: any) {
      return fail(new Error(`QA ${check} execution failed: ${error.message}`));
    } finally {
      await this.fileSystem.remove(reportDir).catch(() => undefined);
    }
  }

  private async execute(
    invocation: CheckInvocation,
    cwd: string,
    bucketKey: string,
    onOutput?: (chunk: string) => void
  ): Promise<{ execution: ProcessExecutionResult; used?: Executable }> {
    let last: ProcessExecutionResult | undefined;
    for (const candidate of invocation.candidates) {
      const execution = await this.processRunner.runCommand(candidate.cmd, candidate.args, { cwd, bucketKey, onOutput });
      last = execution;
      // `python -m x` with x missing exits 1 with "No module named": try the next interpreter too.
      const moduleMissing = !execution.success && invocation.missingToolPattern?.test(execution.stderr);
      if (execution.failureKind !== 'not_found' && !moduleMissing) return { execution, used: candidate };
    }
    return { execution: last!, used: invocation.candidates[invocation.candidates.length - 1] };
  }

  private async readReports(invocation: CheckInvocation): Promise<string[]> {
    if (!invocation.report) return [];
    const { kind, path: reportPath } = invocation.report;
    if (kind === 'file') {
      return (await this.fileSystem.exists(reportPath)) ? [await this.fileSystem.readFile(reportPath)] : [];
    }
    const files = await this.fileSystem.listDirectory(reportPath);
    return Promise.all(files.filter((f) => f.endsWith('.trx')).map((f) => this.fileSystem.readFile(f)));
  }

  private toReport(check: QACheck, invocation: CheckInvocation, output: string, reportContents: string[]): ParsedReport {
    const parsed = invocation.parse?.(output, reportContents);
    if (parsed) return parsed;
    if (check === 'test') return heuristicParse(output);
    const failures = parseDiagnostics(output);
    return { format: 'text', total: failures.length, passed: 0, failed: failures.length, skipped: 0, failures };
  }

  private finalize(options: QARunnerOptions, check: QACheck, command: string, execution: ProcessExecutionResult, report: ParsedReport): QAResult {
    const failures = [...report.failures];
    let failed = report.failed;
    // A non-zero exit with nothing parsed is a compile/config error — never report it as a pass.
    if (!execution.success && failures.length === 0) {
      const detail = firstLine(execution.stderr.split(/\r?\n/).find((l) => /error/i.test(l))) || firstLine(execution.stderr) || firstLine(execution.stdout);
      failures.push({ errorMessage: `'${command}' exited with code ${execution.exitCode} without reporting individual failures: ${detail || 'see rawStderr'}` });
      failed = Math.max(failed, 1);
    }
    const passed = execution.success && failed === 0;

    return {
      stack: options.stack,
      check,
      status: passed ? 'passed' : 'failed',
      passed,
      command,
      reportFormat: report.format,
      totalTests: Math.max(report.total, report.passed + failed + report.skipped),
      passedTests: report.passed,
      failedTestsCount: failed,
      skippedTests: report.skipped,
      failures: failures.slice(0, 50),
      durationMs: execution.durationMs,
      rawStdout: tail(execution.stdout),
      rawStderr: tail(execution.stderr),
    };
  }

  private skipped(options: QARunnerOptions, check: QACheck, reason: string, command: string): QAResult {
    return {
      stack: options.stack,
      check,
      status: 'skipped',
      passed: false,
      command,
      reportFormat: 'text',
      totalTests: 0,
      passedTests: 0,
      failedTestsCount: 0,
      skippedTests: 0,
      failures: [],
      skipReason: reason,
      rawStdout: '',
      rawStderr: '',
    };
  }
}
