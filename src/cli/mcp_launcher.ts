import { NodeFileSystem } from '../shared/infrastructure/file_system.js';
import { NodeProcessRunner } from '../shared/infrastructure/process_runner.js';
import { ResilientProcessRunner } from '../shared/infrastructure/circuit_breaker.js';
import { StateRepository } from '../features/state_management/services/state_repository.js';
import { RagSearchEngine } from '../features/rag_engine/services/rag_search_engine.js';
import { ScaffoldingService } from '../features/scaffolding/services/scaffolding_service.js';
import { QARunnerService } from '../features/quality_assurance/services/qa_runner_service.js';
import { QAAutonomousLoop } from '../features/quality_assurance/services/qa_autonomous_loop.js';
import { SmartCodePatcher } from '../features/quality_assurance/services/ast_code_patcher.js';
import { HexaCoreOrchestrator } from '../features/orchestrator/services/orchestrator_service.js';
import { createToolRegistry } from '../features/mcp_server/infrastructure/mcp_server_factory.js';
import { StackDetector } from '../features/mcp_server/infrastructure/stack_detector.js';
import { HexaCoreMcpServer } from '../features/mcp_server/infrastructure/mcp_stdio_server.js';
import { TelemetryLogWriter } from '../shared/infrastructure/telemetry_log_writer.js';
import { getPackageVersion } from '../shared/infrastructure/package_info.js';

async function bootstrap() {
  const fileSystem = new NodeFileSystem();
  const innerRunner = new NodeProcessRunner();
  const processRunner = new ResilientProcessRunner(innerRunner);

  new TelemetryLogWriter(fileSystem).start();

  const stateRepo = new StateRepository(fileSystem);
  const ragEngine = new RagSearchEngine(fileSystem);
  const scaffoldingService = new ScaffoldingService(fileSystem);
  const qaRunner = new QARunnerService(processRunner);
  const qaLoop = new QAAutonomousLoop(qaRunner);
  const patcher = new SmartCodePatcher(fileSystem);
  const orchestrator = new HexaCoreOrchestrator(stateRepo, ragEngine, scaffoldingService, qaLoop, patcher);

  const toolRegistry = createToolRegistry(stateRepo, ragEngine, scaffoldingService, qaRunner, orchestrator);
  const stackDetector = new StackDetector(fileSystem);

  const server = new HexaCoreMcpServer(toolRegistry, stackDetector, getPackageVersion());
  await server.start();
}

bootstrap().catch((err) => {
  console.error('HexaCore MCP Server Error:', err);
  process.exit(1);
});
