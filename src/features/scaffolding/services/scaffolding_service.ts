import * as path from 'node:path';
import { IFileSystem } from '../../../shared/infrastructure/file_system.js';
import { Result, ok, fail } from '../../../shared/domain/result.js';
import { ScaffoldOptions, ScaffoldResult } from '../domain/scaffold_types.js';
import { generateSliceFiles } from '../generators/stack_generators.js';

export class ScaffoldingService {
  constructor(private readonly fileSystem: IFileSystem) {}

  async executeScaffolding(options: ScaffoldOptions): Promise<Result<ScaffoldResult, Error>> {
    try {
      const files = generateSliceFiles(options);
      const createdFiles: string[] = [];
      const rootDir = options.targetDir || process.cwd();

      for (const file of files) {
        const fullPath = path.join(rootDir, file.path);
        await this.fileSystem.writeFile(fullPath, file.content);
        createdFiles.push(fullPath);
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
