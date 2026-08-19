import { describe, it, expect, vi } from 'vitest';
import { IFileSystem } from '../../src/shared/infrastructure/file_system.js';

vi.mock('../../src/features/scaffolding/generators/stack_generators.js', () => ({
  generateSliceFiles: () => [
    { path: 'src/features/oversized/oversized.ts', content: Array(300).fill('const x = 1;').join('\n') },
  ],
}));

class InMemoryFileSystem implements IFileSystem {
  public writtenFiles = new Map<string, string>();
  async readFile(p: string) { return this.writtenFiles.get(p) || ''; }
  async writeFile(p: string, c: string) { this.writtenFiles.set(p, c); }
  async writeFileAtomic(p: string, c: string) { this.writtenFiles.set(p, c); }
  async exists(p: string) { return this.writtenFiles.has(p); }
  async ensureDir() {}
  async listDirectory() { return Array.from(this.writtenFiles.keys()); }
}

describe('ScaffoldingService policy enforcement', () => {
  it('should block scaffolding when a generated file exceeds the 250-line limit', async () => {
    const { ScaffoldingService } = await import('../../src/features/scaffolding/services/scaffolding_service.js');
    const fs = new InMemoryFileSystem();
    const service = new ScaffoldingService(fs);

    const res = await service.executeScaffolding({ stack: 'node', sliceName: 'oversized', targetDir: '/project' });

    expect(res.isFailure).toBe(true);
    if (res.isFailure) {
      expect(res.error.message).toContain('MAX_LINE_COUNT_EXCEEDED');
    }
    expect(fs.writtenFiles.size).toBe(0);
  });
});
