import { describe, it, expect } from 'vitest';
import { SlicePolicyLinter } from '../../src/features/scaffolding/services/slice_policy_linter.js';
import { IFileSystem } from '../../src/shared/infrastructure/file_system.js';

class MockFs implements IFileSystem {
  async readFile(p: string) {
    if (p.endsWith('large_slice.ts')) {
      return Array(300).fill('const x = 1;').join('\n');
    }
    return 'const clean = true;';
  }
  async writeFile() {}
  async writeFileAtomic() {}
  async exists() { return true; }
  async ensureDir() {}
  async listDirectory() {
    return ['/src/features/order/large_slice.ts'];
  }
}

describe('SlicePolicyLinter', () => {
  it('should flag files exceeding maximum line count policy', async () => {
    const linter = new SlicePolicyLinter(new MockFs());
    const res = await linter.lintSlice('/src/features/order');

    expect(res.isSuccess).toBe(true);
    if (res.isSuccess) {
      expect(res.value).toHaveLength(1);
      expect(res.value[0].rule).toBe('MAX_LINE_COUNT_EXCEEDED');
    }
  });
});
