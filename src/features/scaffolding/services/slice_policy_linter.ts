import { IFileSystem } from '../../../shared/infrastructure/file_system.js';
import { Result, ok, fail } from '../../../shared/domain/result.js';
import { GeneratedFile } from '../domain/scaffold_types.js';

export interface PolicyLintViolation {
  filePath: string;
  rule: string;
  message: string;
}

export class SlicePolicyLinter {
  constructor(private readonly fileSystem: IFileSystem) {}

  /** Lints freshly generated (not yet written) files, regardless of stack/extension. */
  static lintGeneratedFiles(files: GeneratedFile[]): PolicyLintViolation[] {
    const violations: PolicyLintViolation[] = [];

    for (const file of files) {
      const lineCount = file.content.split(/\r?\n/).length;

      if (lineCount > 250) {
        violations.push({
          filePath: file.path,
          rule: 'MAX_LINE_COUNT_EXCEEDED',
          message: `File has ${lineCount} lines, exceeding strict limit of 250 lines.`,
        });
      }

      if (file.content.includes('../../../features/')) {
        violations.push({
          filePath: file.path,
          rule: 'HORIZONTAL_SLICE_COUPLING',
          message: 'Direct cross-slice horizontal import detected violating VSA rules.',
        });
      }
    }

    return violations;
  }

  async lintSlice(sliceDir: string): Promise<Result<PolicyLintViolation[], Error>> {
    try {
      const violations: PolicyLintViolation[] = [];
      const files = await this.fileSystem.listDirectory(sliceDir);

      for (const filePath of files) {
        if (!filePath.endsWith('.ts') && !filePath.endsWith('.cs') && !filePath.endsWith('.ex')) continue;

        const content = await this.fileSystem.readFile(filePath);
        const lineCount = content.split(/\r?\n/).length;

        // Rule 1: Max line count check (< 250 lines)
        if (lineCount > 250) {
          violations.push({
            filePath,
            rule: 'MAX_LINE_COUNT_EXCEEDED',
            message: `File has ${lineCount} lines, exceeding strict limit of 250 lines.`,
          });
        }

        // Rule 2: Cross-slice horizontal import restriction
        if (content.includes('../../../features/') && !filePath.includes('/tests/')) {
          violations.push({
            filePath,
            rule: 'HORIZONTAL_SLICE_COUPLING',
            message: 'Direct cross-slice horizontal import detected violating VSA rules.',
          });
        }
      }

      return ok(violations);
    } catch (error: any) {
      return fail(new Error(`Policy linter failed: ${error.message}`));
    }
  }
}
