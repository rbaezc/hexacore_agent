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

  static validatePath(targetPath: string, allowedRootDir: string = process.cwd()): Result<string, Error> {
    const resolvedTarget = path.resolve(targetPath);
    const resolvedRoot = path.resolve(allowedRootDir);

    if (!resolvedTarget.startsWith(resolvedRoot)) {
      return fail(new Error(`Security Violation: Path '${targetPath}' escapes root workspace boundary.`));
    }
    return ok(resolvedTarget);
  }

  static validateCommand(command: string): Result<string, Error> {
    for (const pattern of this.BLOCKED_PATTERNS) {
      if (pattern.test(command)) {
        return fail(new Error(`Security Violation: Command blocked due to security policy pattern '${pattern}'.`));
      }
    }
    return ok(command);
  }
}
