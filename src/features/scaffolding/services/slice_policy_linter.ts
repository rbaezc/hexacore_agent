import { GeneratedFile } from '../domain/scaffold_types.js';
import { MAX_FILE_LINES } from '../../../shared/domain/policy.js';

export interface PolicyLintViolation {
  filePath: string;
  rule: string;
  message: string;
}

/**
 * Pre-write gate for generated files. Whole-repository checks on existing code
 * (coupling, layer direction) live in the architecture feature (`check_architecture`).
 */
export class SlicePolicyLinter {
  static lintGeneratedFiles(files: Pick<GeneratedFile, 'path' | 'content'>[]): PolicyLintViolation[] {
    const violations: PolicyLintViolation[] = [];

    for (const file of files) {
      const lineCount = file.content.split(/\r?\n/).length;

      if (lineCount > MAX_FILE_LINES) {
        violations.push({
          filePath: file.path,
          rule: 'MAX_LINE_COUNT_EXCEEDED',
          message: `File has ${lineCount} lines, exceeding strict limit of ${MAX_FILE_LINES} lines.`,
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
}
