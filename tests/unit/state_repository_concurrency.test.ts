import { describe, it, expect } from 'vitest';
import { StateRepository } from '../../src/features/state_management/services/state_repository.js';
import { IFileSystem } from '../../src/shared/infrastructure/file_system.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class SlowMockFs implements IFileSystem {
  private store = new Map<string, string>();

  async readFile(p: string) {
    await delay(2);
    return this.store.get(p) || '';
  }

  async writeFile(p: string, c: string) {
    await delay(2);
    this.store.set(p, c);
  }

  async writeFileAtomic(p: string, c: string) {
    await this.writeFile(p, c);
  }

  async exists(p: string) {
    return this.store.has(p);
  }

  async ensureDir() {}
  async listDirectory() {
    return [];
  }
}

describe('StateRepository concurrency', () => {
  it('should not lose facts when addFact is called concurrently', async () => {
    const fs = new SlowMockFs();
    const repo = new StateRepository(fs);

    await Promise.all(
      Array.from({ length: 10 }, (_, i) => repo.addFact({ key: `fact_${i}`, value: String(i), category: 'config' }))
    );

    const finalState = await repo.loadState();
    expect(finalState.isSuccess).toBe(true);
    if (finalState.isSuccess) {
      expect(finalState.value.facts).toHaveLength(10);
    }
  });
});
