import { describe, it, expect } from 'vitest';
import { createToolRegistry } from '../../src/features/mcp_server/infrastructure/mcp_server_factory.js';
import { ToolRegistry } from '../../src/features/mcp_server/services/tool_registry.js';
import { StateRepository } from '../../src/features/state_management/services/state_repository.js';
import { RagSearchEngine } from '../../src/features/rag_engine/services/rag_search_engine.js';
import { ScaffoldingService } from '../../src/features/scaffolding/services/scaffolding_service.js';
import { QARunnerService } from '../../src/features/quality_assurance/services/qa_runner_service.js';
import { QAAutonomousLoop } from '../../src/features/quality_assurance/services/qa_autonomous_loop.js';
import { HexaCoreOrchestrator } from '../../src/features/orchestrator/services/orchestrator_service.js';
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

describe('MCP Server Tool Registry Integration', () => {
  it('should expose tool catalog and handle tool execution requests', async () => {
    const fs = new MockFs();
    const runner = new MockRunner();

    const stateRepo = new StateRepository(fs);
    const ragEngine = new RagSearchEngine(fs);
    const scaffoldingService = new ScaffoldingService(fs);
    const qaRunner = new QARunnerService(runner);
    const qaLoop = new QAAutonomousLoop(qaRunner);
    const orchestrator = new HexaCoreOrchestrator(stateRepo, ragEngine, scaffoldingService, qaLoop);

    const registry: ToolRegistry = createToolRegistry(stateRepo, ragEngine, scaffoldingService, qaRunner, orchestrator);

    const tools = registry.getToolsForStacks(['node']);
    expect(tools.length).toBeGreaterThan(0);

    const resumeTool = registry.getTool('resume_session');
    expect(resumeTool).toBeDefined();
    if (resumeTool) {
      const output = await resumeTool.handler({});
      expect(output.content[0].text).toContain('HexaCore Application');
    }
  });
});
