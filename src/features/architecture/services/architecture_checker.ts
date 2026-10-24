import * as path from 'node:path';
import { IFileSystem, DEFAULT_IGNORED_DIRS } from '../../../shared/infrastructure/file_system.js';
import { WorkspaceContext } from '../../../shared/infrastructure/workspace.js';
import { Result, ok, fail } from '../../../shared/domain/result.js';
import { MAX_FILE_LINES } from '../../../shared/domain/policy.js';
import { ALLOWED_DEPENDENCIES, ArchitectureReport, ArchitectureViolation, SourceLocation } from '../domain/architecture_types.js';
import { classifyPath, isOutOfTreeTest, languageOf, normalizeSlice } from './source_classifier.js';
import { extractImports } from './import_extractor.js';

const MAX_FILES = 5000;
const MAX_FILE_BYTES = 1_000_000;
const MAX_REPORTED = 200;

/** Whole-repository VSA audit: slice coupling, layer direction and file size. Read-only. */
export class ArchitectureChecker {
  constructor(
    private readonly fileSystem: IFileSystem,
    private readonly workspace: WorkspaceContext = new WorkspaceContext()
  ) {}

  async check(subPath: string = '.'): Promise<Result<ArchitectureReport, Error>> {
    const scope = this.workspace.resolveInside(subPath);
    if (scope.isFailure) return fail(scope.error);

    try {
      const all = await this.fileSystem.listDirectory(scope.value, DEFAULT_IGNORED_DIRS);
      const sources = all
        .map((abs) => ({ abs, rel: this.workspace.relative(abs) }))
        .filter((f) => languageOf(f.rel) !== undefined)
        .slice(0, MAX_FILES);

      const elixir = await this.elixirNaming();
      const dartPackage = await this.dartPackage();

      const located = sources.map((f) => ({ ...f, location: this.locate(f.rel, elixir?.app) }));
      const knownSlices = new Set(located.map((f) => f.location?.slice).filter((s): s is string => Boolean(s)));
      const violations: ArchitectureViolation[] = [];

      for (const file of located) {
        const content = await this.fileSystem.readFile(file.abs);
        if (content.length > MAX_FILE_BYTES) continue;
        const lineCount = content.split(/\r?\n/).length;
        const isTest = file.location?.role === 'test' || isOutOfTreeTest(file.rel);

        if (lineCount > MAX_FILE_LINES && !isTest) {
          violations.push({
            rule: 'MAX_LINE_COUNT_EXCEEDED',
            severity: file.location ? 'error' : 'warning',
            file: file.rel,
            message: `${lineCount} lines (limit ${MAX_FILE_LINES}). Split by responsibility.`,
          });
        }
        if (!file.location || isTest) continue;

        const imports = extractImports(content, {
          relPath: file.rel,
          language: languageOf(file.rel)!,
          dartPackage,
          elixirModule: elixir?.module,
          knownSlices,
        });
        for (const ref of imports) {
          const violation = this.evaluate(file.rel, file.location, ref.target, ref.line, ref.specifier);
          if (violation) violations.push(violation);
        }
      }

      const errorCount = violations.filter((v) => v.severity === 'error').length;
      return ok({
        root: this.workspace.relative(scope.value),
        filesScanned: sources.length,
        slices: [...knownSlices].sort(),
        passed: errorCount === 0,
        errorCount,
        warningCount: violations.length - errorCount,
        violations: violations.slice(0, MAX_REPORTED),
        truncated: violations.length > MAX_REPORTED || all.length > MAX_FILES,
      });
    } catch (error: any) {
      return fail(new Error(`Architecture check failed: ${error.message}`));
    }
  }

  private evaluate(file: string, from: SourceLocation, to: SourceLocation, line: number, specifier: string): ArchitectureViolation | undefined {
    if (from.slice !== to.slice) {
      // Reaching another slice's public entry point is a smell; reaching its internals breaks isolation.
      const internal = to.role !== 'module';
      return {
        rule: 'CROSS_SLICE_COUPLING',
        severity: internal ? 'error' : 'warning',
        file,
        line,
        message: `Slice '${from.slice}' imports ${internal ? `${to.role} internals of` : 'the module of'} slice '${to.slice}' (${specifier}). Communicate through shared/domain contracts or domain events.`,
      };
    }
    const allowed = ALLOWED_DEPENDENCIES[from.role];
    if (allowed && to.role !== 'unknown' && to.role !== 'test' && !allowed.includes(to.role)) {
      return {
        rule: 'LAYER_DEPENDENCY_VIOLATION',
        severity: 'error',
        file,
        line,
        message: `${from.role} layer depends on ${to.role} (${specifier}); ${from.role} may only depend on: ${allowed.join(', ')}.`,
      };
    }
    return undefined;
  }

  /** Elixir slices are contexts under lib/<app>/<slice>/; the presentation layer lives in lib/<app>_web/. */
  private locate(rel: string, elixirApp?: string): SourceLocation | undefined {
    const generic = classifyPath(rel);
    if (generic || !elixirApp || !/\.exs?$/.test(rel)) return generic;
    const ctx = rel.match(new RegExp(`(?:^|/)lib/${elixirApp}/([^/]+)/([^/]+)\\.ex$`));
    if (ctx) {
      const file = ctx[2];
      const role = /_context$/.test(file) ? 'application' : /repository$/.test(file) && file !== 'repository' ? 'infrastructure' : 'domain';
      return { slice: normalizeSlice(ctx[1]), role };
    }
    const web = rel.match(new RegExp(`(?:^|/)lib/${elixirApp}_web/controllers/(\\w+)_controller\\.ex$`));
    return web ? { slice: normalizeSlice(web[1]), role: 'presentation' } : undefined;
  }

  private async elixirNaming(): Promise<{ app: string; module: string } | undefined> {
    const mix = await this.readRoot('mix.exs');
    const app = mix.match(/app:\s*:(\w+)/)?.[1];
    if (!app) return undefined;
    const module = mix.match(/defmodule\s+([\w.]+)\.MixProject/)?.[1] ?? app.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join('');
    return { app, module };
  }

  private async dartPackage(): Promise<string | undefined> {
    return (await this.readRoot('pubspec.yaml')).match(/^name:\s*(\w+)/m)?.[1];
  }

  private async readRoot(file: string): Promise<string> {
    const full = path.join(this.workspace.root, file);
    return (await this.fileSystem.exists(full)) ? this.fileSystem.readFile(full) : '';
  }
}
