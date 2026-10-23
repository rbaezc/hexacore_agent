import { describe, it, expect, beforeEach } from 'vitest';
import { StateRepository } from '../../src/features/state_management/services/state_repository.js';
import { InMemoryFileSystem } from '../helpers/in_memory_fs.js';

describe('StateRepository', () => {
  let mockFs: InMemoryFileSystem;
  let repository: StateRepository;

  beforeEach(() => {
    mockFs = new InMemoryFileSystem();
    repository = new StateRepository(mockFs, '/test');
  });

  it('should initialize default state manifest if file does not exist', async () => {
    const res = await repository.loadState();
    expect(res.isSuccess).toBe(true);
    if (res.isSuccess) {
      expect(res.value.metadata.projectName).toBe('test');
      expect(res.value.plans).toEqual([]);
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
