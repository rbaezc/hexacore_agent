import * as path from 'node:path';
import { Result, ok, fail } from '../domain/result.js';

export class SecuritySandboxGuard {
  private static readonly BLOCKED_PATTERNS = [
    /rm\s+-rf/i,
    /del\s+\/f\s+\/s\s+\/q/i,
    /format\s+[a-z]:/i,
    /drop\s+database/i,
    />\s*\/dev\/null/i,
    /chmod\s+777/i,
  ];

  /** Base executables HexaCore is ever allowed to spawn (test runners + package managers it invokes them through). */
  private static readonly ALLOWED_COMMANDS = new Set([
    'mix',
    'dotnet',
    'npx',
    'npm',
    'php',
    'cargo',
    'pytest',
    'go',
    'flutter',
    'bundle',
    'node',
  ]);

  static validatePath(targetPath: string, allowedRootDir: string = process.cwd()): Result<string, Error> {
    const resolvedTarget = path.resolve(targetPath);
    const resolvedRoot = path.resolve(allowedRootDir);

    if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + path.sep)) {
      return fail(new Error(`Security Violation: Path '${targetPath}' escapes root workspace boundary.`));
    }
    return ok(resolvedTarget);
  }

  /** @deprecated substring/shell-string matching only; prefer validateInvocation for argv-based execution. */
  static validateCommand(command: string): Result<string, Error> {
    for (const pattern of this.BLOCKED_PATTERNS) {
      if (pattern.test(command)) {
        return fail(new Error(`Security Violation: Command blocked due to security policy pattern '${pattern}'.`));
      }
    }
    return ok(command);
  }

  /**
   * Validates a no-shell argv invocation: the base executable must be on the allowlist,
   * and the reconstructed invocation must not match a known-dangerous pattern (defense
   * in depth — the primary protection is that argv is never shell-interpreted).
   */
  static validateInvocation(command: string, args: string[] = []): Result<{ command: string; args: string[] }, Error> {
    const baseName = path.basename(command).toLowerCase().replace(/\.(exe|cmd|bat)$/, '');

    if (!this.ALLOWED_COMMANDS.has(baseName)) {
      return fail(new Error(`Security Violation: Executable '${command}' is not on the HexaCore allowlist.`));
    }

    const reconstructed = [command, ...args].join(' ');
    for (const pattern of this.BLOCKED_PATTERNS) {
      if (pattern.test(reconstructed)) {
        return fail(new Error(`Security Violation: Invocation blocked due to security policy pattern '${pattern}'.`));
      }
    }

    return ok({ command, args });
  }
}
