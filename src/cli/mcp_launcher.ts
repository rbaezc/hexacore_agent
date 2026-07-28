import { NodeFileSystem } from '../shared/infrastructure/file_system.js';
import { NodeProcessRunner } from '../shared/infrastructure/process_runner.js';
import { StateRepository } from '../features/state_management/services/state_repository.js';
import { RagSearchEngine } from '../features/rag_engine/services/rag_search_engine.js';
import { ScaffoldingService } from '../features/scaffolding/services/scaffolding_service.js';
import { QARunnerService } from '../features/quality_assurance/services/qa_runner_service.js';
import { HexaCoreOrchestrator } from '../features/orchestrator/services/orchestrator_service.js';
import { createToolRegistry } from '../features/mcp_server/infrastructure/mcp_server_factory.js';
import { StackDetector } from '../features/mcp_server/infrastructure/stack_detector.js';
import { HexaCoreMcpServer } from '../features/mcp_server/infrastructure/mcp_stdio_server.js';

async function bootstrap() {
  const fileSystem = new NodeFileSystem();
  const processRunner = new NodeProcessRunner();

  const stateRepo = new StateRepository(fileSystem);
  const ragEngine = new RagSearchEngine(fileSystem);
  const scaffoldingService = new ScaffoldingService(fileSystem);
  const qaRunner = new QARunnerService(processRunner);
  const orchestrator = new HexaCoreOrchestrator(stateRepo, ragEngine, scaffoldingService, qaRunner);

  const toolRegistry = createToolRegistry(stateRepo, ragEngine, scaffoldingService, qaRunner, orchestrator);
  const stackDetector = new StackDetector(fileSystem);

  const server = new HexaCoreMcpServer(toolRegistry, stackDetector);
  await server.start();
}

bootstrap().catch((err) => {
  console.error('HexaCore MCP Server Error:', err);
  process.exit(1);
});
