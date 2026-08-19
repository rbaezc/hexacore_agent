import * as path from 'node:path';
import { IFileSystem } from '../../../shared/infrastructure/file_system.js';
import { Result, ok, fail } from '../../../shared/domain/result.js';
import { ScaffoldOptions, ScaffoldResult } from '../domain/scaffold_types.js';
import { generateSliceFiles } from '../generators/stack_generators.js';
import { SlicePolicyLinter } from './slice_policy_linter.js';
import { SecuritySandboxGuard } from '../../../shared/infrastructure/security_sandbox.js';

export class ScaffoldingService {
  constructor(private readonly fileSystem: IFileSystem) {}

  async executeScaffolding(options: ScaffoldOptions): Promise<Result<ScaffoldResult, Error>> {
    try {
      if (!/^[a-zA-Z0-9_-]+$/.test(options.sliceName)) {
        return fail(new Error(`Security Violation: sliceName '${options.sliceName}' contains characters outside [a-zA-Z0-9_-].`));
      }

      const files = generateSliceFiles(options);

      const violations = SlicePolicyLinter.lintGeneratedFiles(files);
      if (violations.length > 0) {
        return fail(
          new Error(
            `Scaffolding blocked by VSA policy violations: ${violations
              .map((v) => `[${v.rule}] ${v.filePath}: ${v.message}`)
              .join(' | ')}`
          )
        );
      }

      const createdFiles: string[] = [];
      const rootDir = options.targetDir || process.cwd();

      for (const file of files) {
        const fullPath = path.join(rootDir, file.path);
        const pathCheck = SecuritySandboxGuard.validatePath(fullPath, rootDir);
        if (pathCheck.isFailure) {
          return fail(pathCheck.error);
        }
        await this.fileSystem.writeFile(pathCheck.value, file.content);
        createdFiles.push(pathCheck.value);
      }

      return ok({
        sliceName: options.sliceName,
        stack: options.stack,
        createdFiles,
        success: true,
        message: `Successfully scaffolded slice '${options.sliceName}' for HexaGen stack '${options.stack}'`,
      });
    } catch (error: any) {
      return fail(new Error(`Scaffolding failed: ${error.message}`));
    }
  }
}
