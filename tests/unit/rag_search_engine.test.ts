import { describe, it, expect } from 'vitest';
import { RagSearchEngine } from '../../src/features/rag_engine/services/rag_search_engine.js';
import { IFileSystem } from '../../src/shared/infrastructure/file_system.js';

class MockDocsFileSystem implements IFileSystem {
  async readFile(filePath: string): Promise<string> {
    if (filePath.endsWith('rules.md')) {
      return `# Architecture Rules\n## Vertical Slicing\nEach slice must have its own handler and DTO without cross-importing other slices.`;
    }
    return '';
  }

  async writeFile(): Promise<void> {}
  async exists(): Promise<boolean> { return true; }
  async ensureDir(): Promise<void> {}

  async listDirectory(): Promise<string[]> {
    return ['/docs/rules.md'];
  }
}

describe('RagSearchEngine', () => {
  it('should search and extract matching architectural rules', async () => {
    const mockFs = new MockDocsFileSystem();
    const ragEngine = new RagSearchEngine(mockFs, '/docs');

    const result = await ragEngine.searchRules('vertical slicing handler');
    expect(result.isSuccess).toBe(true);
    if (result.isSuccess) {
      expect(result.value.snippets.length).toBeGreaterThan(0);
      expect(result.value.injectedContext).toContain('Vertical Slicing');
      expect(result.value.snippets[0].content).toContain('Each slice must have its own handler');
    }
  });
});
