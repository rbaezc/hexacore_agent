import * as path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { InMemoryFileSystem } from '../helpers/in_memory_fs.js';
import { WorkspaceContext } from '../../src/shared/infrastructure/workspace.js';

vi.mock('../../src/features/scaffolding/generators/stack_generators.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/features/scaffolding/generators/stack_generators.js')>();
  return {
    ...actual,
    selectFiles: () => [{ path: 'src/features/oversized/oversized.ts', role: 'domain', content: Array(300).fill('const x = 1;').join('\n') }],
  };
});

describe('ScaffoldingService policy enforcement', () => {
  it('blocks scaffolding when a generated file exceeds the 250-line limit, writing nothing', async () => {
    const { ScaffoldingService } = await import('../../src/features/scaffolding/services/scaffolding_service.js');
    const fs = new InMemoryFileSystem();
    const service = new ScaffoldingService(fs, new WorkspaceContext(path.resolve('/project')));

    const res = await service.executeScaffolding({ stack: 'node', sliceName: 'oversized' });

    expect(res.isFailure).toBe(true);
    if (res.isFailure) expect(res.error.message).toContain('MAX_LINE_COUNT_EXCEEDED');
    expect(fs.files.size).toBe(0);
  });
});
