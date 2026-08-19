import { describe, it, expect } from 'vitest';
import { SmartCodePatcher } from '../../src/features/quality_assurance/services/ast_code_patcher.js';
import { IFileSystem } from '../../src/shared/infrastructure/file_system.js';

class MockFs implements IFileSystem {
  private files = new Map<string, string>();
  constructor() {
    this.files.set('/src/test.ts', 'expect true to be false');
  }
  async readFile(p: string) { return this.files.get(p) || ''; }
  async writeFile(p: string, c: string) { this.files.set(p, c); }
  async writeFileAtomic(p: string, c: string) { this.files.set(p, c); }
  async exists(p: string) { return this.files.has(p); }
  async ensureDir() {}
  async listDirectory() { return Array.from(this.files.keys()); }
}

describe('SmartCodePatcher', () => {
  it('should auto-patch failing code assertion pattern', async () => {
    const fs = new MockFs();
    const patcher = new SmartCodePatcher(fs);

    const result = await patcher.applyFix({
      stack: 'node',
      passed: false,
      totalTests: 1,
      failedTestsCount: 1,
      failures: [{ file: '/src/test.ts', errorMessage: 'expected true to be false', rawOutput: '' }],
      rawStdout: '',
      rawStderr: '',
    });

    expect(result).toBe(true);
    const patchedContent = await fs.readFile('/src/test.ts');
    expect(patchedContent).toBe('expect true to be true');
  });
});
