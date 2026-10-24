import { IFileSystem, NodeFileSystem } from './shared/infrastructure/file_system.js';
import { IProcessRunner, NodeProcessRunner } from './shared/infrastructure/process_runner.js';
import { ResilientProcessRunner } from './shared/infrastructure/circuit_breaker.js';
import { WorkspaceContext } from './shared/infrastructure/workspace.js';
import { TelemetryLogWriter } from './shared/infrastructure/telemetry_log_writer.js';
import { LlmClient } from './shared/domain/llm_client.js';
import { StateRepository } from './features/state_management/services/state_repository.js';
import { RagSearchEngine } from './features/rag_engine/services/rag_search_engine.js';
import { ChangeJournal } from './shared/infrastructure/change_journal.js';
import { ScaffoldingService } from './features/scaffolding/services/scaffolding_service.js';
import { QARunnerService } from './features/quality_assurance/services/qa_runner_service.js';
import { QAAutonomousLoop } from './features/quality_assurance/services/qa_autonomous_loop.js';
import { LlmCodePatcher } from './features/quality_assurance/services/llm_code_patcher.js';
import { ArchitectureChecker } from './features/architecture/services/architecture_checker.js';
import { HexaCoreOrchestrator } from './features/orchestrator/services/orchestrator_service.js';
import { DecisionRecorder } from './features/design/services/decision_recorder.js';
import { ContractDesigner } from './features/design/services/contract_designer.js';
import { StackDetector } from './features/mcp_server/infrastructure/stack_detector.js';
import { LearningRepository } from './features/learning/services/learning_repository.js';
import { LearningService } from './features/learning/services/learning_service.js';
import { LessonAuthoring } from './features/learning/services/lesson_authoring.js';
import { LessonFinder } from './features/learning/services/lesson_finder.js';

export interface HexaCoreServices {
  workspace: WorkspaceContext;
  fileSystem: IFileSystem;
  stateRepo: StateRepository;
  ragEngine: RagSearchEngine;
  journal: ChangeJournal;
  scaffolding: ScaffoldingService;
  qaRunner: QARunnerService;
  qaLoop: QAAutonomousLoop;
  architecture: ArchitectureChecker;
  orchestrator: HexaCoreOrchestrator;
  decisions: DecisionRecorder;
  contracts: ContractDesigner;
  stackDetector: StackDetector;
  learning: LearningService;
  lessons: LessonAuthoring;
  /** Set by the MCP server once the client proves it supports sampling. */
  llm: { client?: LlmClient };
}

export interface HexaCoreOptions {
  workspaceRoot?: string;
  fileSystem?: IFileSystem;
  /** Raw runner; it is always wrapped in the sandbox + circuit breaker. */
  processRunner?: IProcessRunner;
  maxFixIterations?: number;
  /** Persist telemetry spans to .hexagen/telemetry.log (default true). */
  telemetryLog?: boolean;
}

export function createHexaCore(options: HexaCoreOptions = {}): HexaCoreServices {
  const workspace = new WorkspaceContext(options.workspaceRoot);
  const fileSystem = options.fileSystem ?? new NodeFileSystem();
  const processRunner = new ResilientProcessRunner(options.processRunner ?? new NodeProcessRunner());
  const llm: HexaCoreServices['llm'] = {};

  if (options.telemetryLog !== false) new TelemetryLogWriter(fileSystem, workspace).start();

  const stateRepo = new StateRepository(fileSystem, workspace);
  const journal = new ChangeJournal(fileSystem, workspace);
  const learningRepo = new LearningRepository(fileSystem, workspace);
  const lessonFinder = new LessonFinder(fileSystem, workspace, async (query, dir, boost) => {
    const engine = new RagSearchEngine(fileSystem, [{ dir, source: 'lesson' }], { boostProvider: async () => boost });
    const result = await engine.searchRules(query, 50);
    return result.isSuccess ? result.value.snippets : [];
  });
  const learning = new LearningService(learningRepo, lessonFinder);
  const ragEngine = new RagSearchEngine(fileSystem, workspace, { boostProvider: () => learning.documentBoost() });
  const scaffolding = new ScaffoldingService(fileSystem, workspace, journal);
  const qaRunner = new QARunnerService(processRunner, fileSystem);
  const qaLoop = new QAAutonomousLoop(qaRunner, options.maxFixIterations ?? 3, journal);
  const architecture = new ArchitectureChecker(fileSystem, workspace);

  const orchestrator = new HexaCoreOrchestrator({
    stateRepo,
    ragEngine,
    scaffolding,
    qaRunner,
    qaLoop,
    architecture,
    workspace,
    patcherFactory: () => (llm.client ? new LlmCodePatcher(fileSystem, workspace, journal, llm.client) : undefined),
    onQaResults: (results, cwd) => learning.observe(results, workspace.relative(cwd)),
  });

  return {
    workspace,
    fileSystem,
    stateRepo,
    ragEngine,
    journal,
    scaffolding,
    qaRunner,
    qaLoop,
    architecture,
    orchestrator,
    decisions: new DecisionRecorder(fileSystem, workspace, journal, stateRepo),
    contracts: new ContractDesigner(workspace, journal),
    stackDetector: new StackDetector(fileSystem),
    learning,
    lessons: new LessonAuthoring(fileSystem, workspace, journal, learningRepo, lessonFinder),
    llm,
  };
}
