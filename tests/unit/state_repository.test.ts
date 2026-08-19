import { describe, it, expect, beforeEach } from 'vitest';
import { StateRepository } from '../../src/features/state_management/services/state_repository.js';
import { IFileSystem } from '../../src/shared/infrastructure/file_system.js';

class MockFileSystem implements IFileSystem {
  private files = new Map<string, string>();

  async readFile(filePath: string): Promise<string> {
    const data = this.files.get(filePath);
    if (!data) throw new Error('File not found');
    return data;
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    this.files.set(filePath, content);
  }

  async writeFileAtomic(filePath: string, content: string): Promise<void> {
    this.files.set(filePath, content);
  }

  async exists(filePath: string): Promise<boolean> {
    return this.files.has(filePath);
  }

  async ensureDir(): Promise<void> {}
  async listDirectory(): Promise<string[]> {
    return Array.from(this.files.keys());
  }
}

describe('StateRepository', () => {
  let mockFs: MockFileSystem;
  let repository: StateRepository;

  beforeEach(() => {
    mockFs = new MockFileSystem();
    repository = new StateRepository(mockFs, '/test');
  });

  it('should initialize default state manifest if file does not exist', async () => {
    const res = await repository.loadState();
    expect(res.isSuccess).toBe(true);
    if (res.isSuccess) {
      expect(res.value.metadata.projectName).toBe('HexaCore Application');
      expect(res.value.facts).toHaveLength(0);
    }
  });

  it('should add transactional case facts atomically', async () => {
    await repository.loadState();
    const addRes = await repository.addFact({
      key: 'db_host',
      value: 'localhost',
      category: 'config',
    });
    expect(addRes.isSuccess).toBe(true);
    if (addRes.isSuccess) {
      expect(addRes.value.facts).toHaveLength(1);
      expect(addRes.value.facts[0].key).toBe('db_host');
    }
  });

  it('should update ledger steps correctly', async () => {
    await repository.loadState();
    const updateRes = await repository.updateLedgerStep({
      id: 'step_1',
      title: 'Scaffold Payment',
      description: 'Created payment slice',
      status: 'completed',
      timestamp: new Date().toISOString(),
    });
    expect(updateRes.isSuccess).toBe(true);
    if (updateRes.isSuccess) {
      expect(updateRes.value.ledger[0].id).toBe('step_1');
      expect(updateRes.value.ledger[0].status).toBe('completed');
    }
  });
});
