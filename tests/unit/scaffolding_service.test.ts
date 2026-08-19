import { describe, it, expect } from 'vitest';
import { ScaffoldingService } from '../../src/features/scaffolding/services/scaffolding_service.js';
import { IFileSystem } from '../../src/shared/infrastructure/file_system.js';

class InMemoryFileSystem implements IFileSystem {
  public writtenFiles = new Map<string, string>();

  async readFile(filePath: string): Promise<string> {
    return this.writtenFiles.get(filePath) || '';
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    this.writtenFiles.set(filePath, content);
  }

  async writeFileAtomic(filePath: string, content: string): Promise<void> {
    this.writtenFiles.set(filePath, content);
  }

  async exists(filePath: string): Promise<boolean> {
    return this.writtenFiles.has(filePath);
  }

  async ensureDir(): Promise<void> {}
  async listDirectory(): Promise<string[]> {
    return Array.from(this.writtenFiles.keys());
  }
}

describe('ScaffoldingService', () => {
  it('should scaffold a full 4-layer Node.js vertical slice correctly', async () => {
    const fs = new InMemoryFileSystem();
    const service = new ScaffoldingService(fs);

    const res = await service.executeScaffolding({
      stack: 'node',
      sliceName: 'orders',
      targetDir: '/project',
    });

    expect(res.isSuccess).toBe(true);
    if (res.isSuccess) {
      expect(res.value.createdFiles).toHaveLength(4);
      expect(fs.writtenFiles.size).toBe(4);

      const handlerPath = res.value.createdFiles.find((f) => f.includes('orders_handler.ts'));
      expect(handlerPath).toBeDefined();
      const handler = await fs.readFile(handlerPath!);
      expect(handler).toContain('OrdersRepository');
      expect(handler).toContain('this.repository.save(entity)');
    }
  });

  it('should scaffold a full 4-layer .NET C# vertical slice correctly', async () => {
    const fs = new InMemoryFileSystem();
    const service = new ScaffoldingService(fs);

    const res = await service.executeScaffolding({
      stack: 'dotnet',
      sliceName: 'billing',
      targetDir: '/project',
    });

    expect(res.isSuccess).toBe(true);
    if (res.isSuccess) {
      expect(res.value.createdFiles).toHaveLength(4);
    }
  });

  it('should scaffold only the requested layer when one is specified', async () => {
    const fs = new InMemoryFileSystem();
    const service = new ScaffoldingService(fs);

    const res = await service.executeScaffolding({
      stack: 'python',
      sliceName: 'payment',
      layer: 'domain',
      targetDir: '/project',
    });

    expect(res.isSuccess).toBe(true);
    if (res.isSuccess) {
      expect(res.value.createdFiles).toHaveLength(1);
      expect(res.value.createdFiles[0]).toContain('domain.py');
    }
  });
});
