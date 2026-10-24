import * as path from 'node:path';
import { Result, ok, fail } from '../domain/result.js';
import { SecuritySandboxGuard } from './security_sandbox.js';

/**
 * The project directory HexaCore operates on. It's mutable on purpose: an MCP client
 * announces its workspace roots only after the handshake, so services must read the
 * root at call time instead of capturing `process.cwd()` at construction.
 */
export class WorkspaceContext {
  private currentRoot: string;

  constructor(initialRoot: string = process.env.HEXACORE_WORKSPACE || process.cwd()) {
    this.currentRoot = path.resolve(initialRoot);
  }

  get root(): string {
    return this.currentRoot;
  }

  setRoot(newRoot: string): void {
    this.currentRoot = path.resolve(newRoot);
  }

  /** `.hexagen/` metadata directory (state, telemetry, checkpoints) inside the workspace. */
  hexagenPath(...segments: string[]): string {
    return path.join(this.currentRoot, '.hexagen', ...segments);
  }

  /** Resolves a caller-supplied (possibly relative) path, refusing anything outside the workspace. */
  resolveInside(relativeOrAbsolute: string = '.'): Result<string, Error> {
    const candidate = path.isAbsolute(relativeOrAbsolute)
      ? relativeOrAbsolute
      : path.join(this.currentRoot, relativeOrAbsolute);
    const check = SecuritySandboxGuard.validatePath(candidate, this.currentRoot);
    return check.isSuccess ? ok(check.value) : fail(check.error);
  }

  relative(absolutePath: string): string {
    return path.relative(this.currentRoot, absolutePath).split(path.sep).join('/') || '.';
  }
}
