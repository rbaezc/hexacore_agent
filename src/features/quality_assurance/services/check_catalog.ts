import * as path from 'node:path';
import { IFileSystem } from '../../../shared/infrastructure/file_system.js';
import { SupportedStack } from '../../../shared/domain/stack.js';
import { ParsedReport, QACheck } from '../domain/qa_types.js';
import { parseFlutterJson, parseGoTestJson, parseJestLikeJson, parseRspecJson } from './parsers/json_reporters.js';
import { mergeReports, parseJUnitXml, parseTrx } from './parsers/xml_reporters.js';
import { parseCargoTest, parseMixTest } from './parsers/text_reporters.js';
import { parseEslintJson, parseMixFormat } from './parsers/lint_reporters.js';

export interface Executable {
  cmd: string;
  args: string[];
}

/** How to run one check, and how to turn its output into a report. */
export interface CheckInvocation {
  /** Tried in order; later entries are used only when an earlier executable is not installed. */
  candidates: Executable[];
  /** Where the runner writes its machine-readable report (a file or, for TRX, a directory). */
  report?: { kind: 'file' | 'dir'; path: string };
  /** undefined → fall back to diagnostics/heuristics. */
  parse?: (output: string, reportContents: string[]) => ParsedReport | undefined;
  /** Output that means "the tool isn't installed in this project" even though the launcher was found. */
  missingToolPattern?: RegExp;
}

export type CheckPlan = { invocation: CheckInvocation } | { skip: string };

interface Probe {
  has(rel: string): Promise<boolean>;
  read(rel: string): Promise<string>;
  packageJson(): Promise<any>;
}

const NPX_MISSING = /could not determine executable|canceled due to missing packages|missing packages:/i;
const PY_MISSING = /No module named/;

export class CheckCatalog {
  constructor(private readonly fileSystem: IFileSystem) {}

  async plan(stack: SupportedStack, check: QACheck, cwd: string, scope: string[], reportDir: string): Promise<CheckPlan> {
    const probe = this.probe(cwd);
    switch (stack) {
      case 'node':
      case 'react':
      case 'reactnative':
        return this.javascript(check, probe, scope, reportDir);
      case 'python':
        return this.python(check, scope, reportDir);
      case 'go':
        return this.go(check, scope);
      case 'rust':
        return this.rust(check, scope);
      case 'dotnet':
        return this.dotnet(check, scope, reportDir);
      case 'laravel':
        return this.laravel(check, probe, scope, reportDir);
      case 'elixir':
        return this.elixir(check, scope);
      case 'flutter':
        return this.flutter(check, scope);
      case 'ruby':
        return this.ruby(check, probe, scope, reportDir);
    }
  }

  private async javascript(check: QACheck, probe: Probe, scope: string[], reportDir: string): Promise<CheckPlan> {
    const pkg = await probe.packageJson();
    const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
    const scripts = pkg?.scripts ?? {};
    const reportFile = path.join(reportDir, 'report.json');

    if (check === 'test') {
      if (deps.vitest) {
        return plan({
          candidates: [{ cmd: 'npx', args: ['--no', '--', 'vitest', 'run', '--reporter=json', `--outputFile=${reportFile}`, ...scope] }],
          report: { kind: 'file', path: reportFile },
          parse: (_out, files) => parseJestLikeJson(files[0] ?? ''),
          missingToolPattern: NPX_MISSING,
        });
      }
      if (deps.jest) {
        return plan({
          candidates: [{ cmd: 'npx', args: ['--no', '--', 'jest', '--json', `--outputFile=${reportFile}`, ...scope] }],
          report: { kind: 'file', path: reportFile },
          parse: (_out, files) => parseJestLikeJson(files[0] ?? ''),
          missingToolPattern: NPX_MISSING,
        });
      }
      if (scripts.test) return plan({ candidates: [{ cmd: 'npm', args: ['test', '--', ...scope] }] });
      return { skip: 'No test runner found (expected vitest or jest in package.json, or a "test" script).' };
    }
    if (check === 'typecheck') {
      if (!(await probe.has('tsconfig.json'))) return { skip: 'No tsconfig.json; nothing to typecheck.' };
      return plan({ candidates: [{ cmd: 'npx', args: ['--no', '--', 'tsc', '--noEmit', '--pretty', 'false', '--project', '.'] }], missingToolPattern: NPX_MISSING });
    }
    if (check === 'lint') {
      const configs = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc'];
      const hasConfig = (await Promise.all(configs.map((c) => probe.has(c)))).some(Boolean);
      if (!hasConfig) return { skip: 'No ESLint configuration found.' };
      return plan({
        candidates: [{ cmd: 'npx', args: ['--no', '--', 'eslint', '.', '--format', 'json', '--output-file', reportFile] }],
        report: { kind: 'file', path: reportFile },
        parse: (_out, files) => parseEslintJson(files[0] ?? ''),
        missingToolPattern: NPX_MISSING,
      });
    }
    if (!scripts.build) return { skip: 'No "build" script in package.json.' };
    return plan({ candidates: [{ cmd: 'npm', args: ['run', 'build'] }] });
  }

  private python(check: QACheck, scope: string[], reportDir: string): CheckPlan {
    const viaModule = (mod: string, args: string[]): Executable[] => [
      { cmd: 'python', args: ['-m', mod, ...args] },
      { cmd: 'python3', args: ['-m', mod, ...args] },
    ];
    if (check === 'test') {
      const reportFile = path.join(reportDir, 'junit.xml');
      // xunit1 is the JUnit flavour that carries file + line per test case.
      const args = ['-q', '-o', 'junit_family=xunit1', `--junitxml=${reportFile}`, ...scope];
      return plan({
        candidates: [{ cmd: 'pytest', args }, ...viaModule('pytest', args)],
        report: { kind: 'file', path: reportFile },
        parse: (_out, files) => parseJUnitXml(files[0] ?? ''),
        missingToolPattern: PY_MISSING,
      });
    }
    if (check === 'typecheck') return plan({ candidates: viaModule('mypy', ['.', '--no-error-summary']), missingToolPattern: PY_MISSING });
    if (check === 'lint') return plan({ candidates: viaModule('ruff', ['check', '--output-format', 'concise', '.']), missingToolPattern: PY_MISSING });
    return plan({ candidates: viaModule('compileall', ['-q', '-x', '(^|[\\\\/])(\\.venv|venv|node_modules|\\.git)([\\\\/]|$)', '.']) });
  }

  private go(check: QACheck, scope: string[]): CheckPlan {
    if (check === 'test') {
      const hasPackage = scope.some((s) => s.startsWith('.') || s.includes('/'));
      return plan({
        candidates: [{ cmd: 'go', args: ['test', '-json', ...(hasPackage ? [] : ['./...']), ...scope] }],
        parse: (out) => parseGoTestJson(out),
      });
    }
    if (check === 'lint') return plan({ candidates: [{ cmd: 'go', args: ['vet', './...'] }] });
    return plan({ candidates: [{ cmd: 'go', args: ['build', './...'] }] });
  }

  private rust(check: QACheck, scope: string[]): CheckPlan {
    if (check === 'test') {
      return plan({ candidates: [{ cmd: 'cargo', args: ['test', '--no-fail-fast', ...scope] }], parse: (out) => parseCargoTest(out) });
    }
    const sub = check === 'typecheck' ? ['check'] : check === 'build' ? ['build'] : ['clippy'];
    const extra = check === 'lint' ? ['--', '-D', 'warnings'] : [];
    return plan({ candidates: [{ cmd: 'cargo', args: [...sub, '--message-format', 'short', ...extra] }] });
  }

  private dotnet(check: QACheck, scope: string[], reportDir: string): CheckPlan {
    if (check === 'test') {
      return plan({
        candidates: [{ cmd: 'dotnet', args: ['test', '--nologo', '--logger', 'trx', '--results-directory', reportDir, ...scope] }],
        report: { kind: 'dir', path: reportDir },
        // One TRX per test project.
        parse: (_out, files) => mergeReports(files.map((f) => parseTrx(f)).filter((r): r is ParsedReport => Boolean(r))),
      });
    }
    if (check === 'lint') return plan({ candidates: [{ cmd: 'dotnet', args: ['format', '--verify-no-changes', '--verbosity', 'quiet'] }] });
    return plan({ candidates: [{ cmd: 'dotnet', args: ['build', '--nologo', '-clp:NoSummary'] }] });
  }

  private async laravel(check: QACheck, probe: Probe, scope: string[], reportDir: string): Promise<CheckPlan> {
    if (check === 'test') {
      const reportFile = path.join(reportDir, 'junit.xml');
      const runner = (await probe.has('artisan'))
        ? ['artisan', 'test']
        : (await probe.has('vendor/bin/pest'))
          ? ['vendor/bin/pest']
          : (await probe.has('vendor/bin/phpunit'))
            ? ['vendor/bin/phpunit']
            : undefined;
      if (!runner) return { skip: 'No artisan, Pest or PHPUnit found (run composer install).' };
      return plan({
        candidates: [{ cmd: 'php', args: [...runner, `--log-junit=${reportFile}`, ...scope] }],
        report: { kind: 'file', path: reportFile },
        parse: (_out, files) => parseJUnitXml(files[0] ?? ''),
      });
    }
    if (check === 'typecheck') {
      if (!(await probe.has('vendor/bin/phpstan'))) return { skip: 'PHPStan is not installed (vendor/bin/phpstan).' };
      return plan({ candidates: [{ cmd: 'php', args: ['vendor/bin/phpstan', 'analyse', '--error-format=raw', '--no-progress'] }] });
    }
    if (check === 'lint') {
      if (!(await probe.has('vendor/bin/pint'))) return { skip: 'Laravel Pint is not installed (vendor/bin/pint).' };
      return plan({ candidates: [{ cmd: 'php', args: ['vendor/bin/pint', '--test'] }] });
    }
    return { skip: 'PHP has no build step; use typecheck (PHPStan) instead.' };
  }

  private elixir(check: QACheck, scope: string[]): CheckPlan {
    if (check === 'test') return plan({ candidates: [{ cmd: 'mix', args: ['test', ...scope] }], parse: (out) => parseMixTest(out) });
    if (check === 'lint') {
      return plan({ candidates: [{ cmd: 'mix', args: ['format', '--check-formatted'] }], parse: (out) => parseMixFormat(out) });
    }
    return plan({ candidates: [{ cmd: 'mix', args: ['compile', '--warnings-as-errors'] }] });
  }

  private flutter(check: QACheck, scope: string[]): CheckPlan {
    if (check === 'test') {
      return plan({ candidates: [{ cmd: 'flutter', args: ['test', '--reporter', 'json', ...scope] }], parse: (out) => parseFlutterJson(out) });
    }
    if (check === 'build') return { skip: 'Flutter builds are platform-specific; use typecheck (flutter analyze) instead.' };
    return plan({ candidates: [{ cmd: 'flutter', args: ['analyze', '--no-pub'] }] });
  }

  private async ruby(check: QACheck, probe: Probe, scope: string[], reportDir: string): Promise<CheckPlan> {
    if (check === 'test') {
      const reportFile = path.join(reportDir, 'rspec.json');
      return plan({
        candidates: [{ cmd: 'bundle', args: ['exec', 'rspec', '--format', 'progress', '--format', 'json', '--out', reportFile, ...scope] }],
        report: { kind: 'file', path: reportFile },
        parse: (_out, files) => parseRspecJson(files[0] ?? ''),
      });
    }
    if (check === 'lint') {
      const lock = await probe.read('Gemfile.lock');
      if (!/^\s+rubocop\b/m.test(lock)) return { skip: 'RuboCop is not in Gemfile.lock.' };
      return plan({ candidates: [{ cmd: 'bundle', args: ['exec', 'rubocop', '--format', 'emacs'] }] });
    }
    return { skip: `Ruby has no ${check} step.` };
  }

  private probe(cwd: string): Probe {
    const fs = this.fileSystem;
    return {
      has: (rel) => fs.exists(path.join(cwd, rel)),
      read: async (rel) => ((await fs.exists(path.join(cwd, rel))) ? fs.readFile(path.join(cwd, rel)) : ''),
      packageJson: async () => {
        try {
          return JSON.parse(await fs.readFile(path.join(cwd, 'package.json')));
        } catch {
          return undefined;
        }
      },
    };
  }
}

function plan(invocation: CheckInvocation): CheckPlan {
  return { invocation };
}
