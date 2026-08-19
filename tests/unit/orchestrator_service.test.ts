import { describe, it, expect } from 'vitest';
import { HexaCoreOrchestrator } from '../../src/features/orchestrator/services/orchestrator_service.js';
import { StateRepository } from '../../src/features/state_management/services/state_repository.js';
import { RagSearchEngine } from '../../src/features/rag_engine/services/rag_search_engine.js';
import { ScaffoldingService } from '../../src/features/scaffolding/services/scaffolding_service.js';
import { QARunnerService } from '../../src/features/quality_assurance/services/qa_runner_service.js';
import { QAAutonomousLoop } from '../../src/features/quality_assurance/services/qa_autonomous_loop.js';
import { IFileSystem } from '../../src/shared/infrastructure/file_system.js';
import { IProcessRunner } from '../../src/shared/infrastructure/process_runner.js';

class MockFs implements IFileSystem {
  private store = new Map<string, string>();
  async readFile(p: string) { return this.store.get(p) || ''; }
  async writeFile(p: string, c: string) { this.store.set(p, c); }
  async writeFileAtomic(p: string, c: string) { this.store.set(p, c); }
  async exists(p: string) { return this.store.has(p); }
  async ensureDir() {}
  async listDirectory() { return []; }
}

class MockRunner implements IProcessRunner {
  async runCommand() {
    return { stdout: 'PASS', stderr: '', exitCode: 0, success: true };
  }
}

describe('HexaCoreOrchestrator', () => {
  it('should run full orchestration pipeline (RAG -> Scaffold -> QA)', async () => {
    const fs = new MockFs();
    const runner = new MockRunner();

    const stateRepo = new StateRepository(fs);
    const ragEngine = new RagSearchEngine(fs);
    const scaffoldingService = new ScaffoldingService(fs);
    const qaRunner = new QARunnerService(runner);
    const qaLoop = new QAAutonomousLoop(qaRunner);

    const orchestrator = new HexaCoreOrchestrator(stateRepo, ragEngine, scaffoldingService, qaLoop);

    const result = await orchestrator.orchestrate({
      id: 'req_123',
      description: 'Implement auth slice',
      targetStack: 'node',
      sliceName: 'auth',
    });

    expect(result.isSuccess).toBe(true);
    if (result.isSuccess) {
      expect(result.value.steps).toHaveLength(3);
      expect(result.value.success).toBe(true);
    }
  });

  it('should auto-heal via the patcher when QA fails on the first pass', async () => {
    const fs = new MockFs();

    let calls = 0;
    const flakyRunner: IProcessRunner = {
      async runCommand() {
        calls++;
        if (calls === 1) {
          return { stdout: 'FAIL src/broken.ts\nAssertionError: expected true to be false', stderr: '', exitCode: 1, success: false };
        }
        return { stdout: 'PASS', stderr: '', exitCode: 0, success: true };
      },
    };

    const stateRepo = new StateRepository(fs);
    const ragEngine = new RagSearchEngine(fs);
    const scaffoldingService = new ScaffoldingService(fs);
    const qaRunner = new QARunnerService(flakyRunner);
    const qaLoop = new QAAutonomousLoop(qaRunner);
    const patcher = { applyFix: async () => true };

    const orchestrator = new HexaCoreOrchestrator(stateRepo, ragEngine, scaffoldingService, qaLoop, patcher);

    const result = await orchestrator.orchestrate({
      id: 'req_456',
      description: 'Implement billing slice',
      targetStack: 'node',
      sliceName: 'billing',
    });

    expect(result.isSuccess).toBe(true);
    if (result.isSuccess) {
      expect(result.value.success).toBe(true);
      expect(result.value.steps[2].status).toBe('completed');
      expect(result.value.steps[2].output).toContain('iteration 2: fixed');
    }
  });
});
