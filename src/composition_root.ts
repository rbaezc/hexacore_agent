import * as os from 'node:os';
import * as path from 'node:path';
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
import { LessonLibrary } from './features/learning/services/lesson_library.js';
import { WorkspaceSnapshots } from './features/learning/services/workspace_snapshots.js';
import { FixAttributor } from './features/learning/services/fix_attributor.js';
import { LessonSearch } from './features/learning/domain/learning_types.js';
import { ProfileService } from './features/user_profile/services/profile_service.js';
import { UiCheckOutcome, UiCheckPort } from './features/quality_assurance/domain/qa_types.js';
import { PrototypeStore } from './features/prototyping/services/prototype_store.js';
import { PreviewServer } from './features/prototyping/services/preview_server.js';
import { UiAuditor } from './features/prototyping/services/ui_auditor.js';
import { PrototypePromoter } from './features/prototyping/services/prototype_promoter.js';
import { BrowserDriver, PlaywrightDriver, loadPlaywright } from './features/prototyping/services/playwright_driver.js';
import { UiAuditReport, UiFinding } from './features/prototyping/domain/prototype_types.js';
import { ok, fail } from './shared/domain/result.js';

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
  profile: ProfileService;
  prototypes: { store: PrototypeStore; preview: PreviewServer; auditor: UiAuditor; promoter: PrototypePromoter };
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
  /**
   * The user's cross-project lesson library (default $HEXACORE_HOME or ~/.hexacore;
   * HEXACORE_LIBRARY=off disables it). false disables it too.
   */
  lessonLibrary?: string | false;
  /** The user profile file (default <HEXACORE_HOME or ~/.hexacore>/profile.json; HEXACORE_PROFILE=off disables it). false disables it too. */
  userProfile?: string | false;
  /** Local preview server for prototypes (default port $HEXACORE_PREVIEW_PORT or 4173; HEXACORE_PREVIEW=off disables it). false disables it too. */
  preview?: { port?: number; keepAlive?: boolean } | false;
  /** Browser for the rendered part of the 'ui' check (default: Playwright, when the project has it). */
  browserDriver?: () => BrowserDriver | undefined;
}

function hexacoreHome(): string {
  return path.resolve(process.env.HEXACORE_HOME ?? path.join(os.homedir(), '.hexacore'));
}

function libraryRoot(option: HexaCoreOptions['lessonLibrary']): string | undefined {
  if (option === false || (option === undefined && process.env.HEXACORE_LIBRARY === 'off')) return undefined;
  return option ? path.resolve(option) : hexacoreHome();
}

/** HEXACORE_PREVIEW_PORT (0 = any free port); 4173 by default. */
function previewPortFromEnv(): number {
  const port = Number(process.env.HEXACORE_PREVIEW_PORT);
  return process.env.HEXACORE_PREVIEW_PORT && Number.isInteger(port) && port >= 0 && port < 65536 ? port : 4173;
}

function userProfilePath(option: HexaCoreOptions['userProfile']): string | undefined {
  if (option === false || (option === undefined && process.env.HEXACORE_PROFILE === 'off')) return undefined;
  return option ? path.resolve(option) : path.join(hexacoreHome(), 'profile.json');
}

export function createHexaCore(options: HexaCoreOptions = {}): HexaCoreServices {
  const workspace = new WorkspaceContext(options.workspaceRoot);
  const fileSystem = options.fileSystem ?? new NodeFileSystem();
  const processRunner = new ResilientProcessRunner(options.processRunner ?? new NodeProcessRunner());
  const llm: HexaCoreServices['llm'] = {};

  if (options.telemetryLog !== false) new TelemetryLogWriter(fileSystem, workspace).start();

  const stateRepo = new StateRepository(fileSystem, workspace);
  const journal = new ChangeJournal(fileSystem, workspace);
  const learningRepo = new LearningRepository(fileSystem, () => workspace.hexagenPath('learning.json'));
  const lessonSearch: LessonSearch = async (query, dir, boost) => {
    const engine = new RagSearchEngine(fileSystem, [{ dir, source: 'lesson' }], { boostProvider: async () => boost });
    const result = await engine.searchRules(query, 50);
    return result.isSuccess ? result.value.snippets : [];
  };
  const lessonFinder = new LessonFinder(fileSystem, { root: () => workspace.root, skillsDir: () => workspace.hexagenPath('skills') }, lessonSearch);
  const libraryDir = libraryRoot(options.lessonLibrary);
  const library = libraryDir ? new LessonLibrary(fileSystem, libraryDir, lessonSearch) : undefined;
  const projectName = () => path.basename(workspace.root);
  const userProfileFile = userProfilePath(options.userProfile);
  const learning = new LearningService({
    repo: learningRepo,
    finder: lessonFinder,
    attributor: new FixAttributor(new WorkspaceSnapshots(fileSystem, workspace), lessonFinder, library),
    library,
    projectName,
  });
  const ragEngine = new RagSearchEngine(
    fileSystem,
    () => [...RagSearchEngine.workspaceRoots(workspace), ...(library ? [{ dir: library.finder.skillsDir(), source: 'lesson' as const }] : [])],
    { boostProvider: () => learning.documentBoost() }
  );
  const scaffolding = new ScaffoldingService(fileSystem, workspace, journal);
  const prototypeStore = new PrototypeStore(fileSystem, workspace, journal);
  const preview = new PreviewServer(fileSystem, () => prototypeStore.root(), {
    enabled: options.preview !== false && !(options.preview === undefined && process.env.HEXACORE_PREVIEW === 'off'),
    port: (options.preview ? options.preview.port : undefined) ?? previewPortFromEnv(),
    keepAlive: Boolean(options.preview && options.preview.keepAlive),
  });
  const browserDriver =
    options.browserDriver ??
    (() => {
      const playwright = loadPlaywright(workspace.root);
      return playwright ? new PlaywrightDriver(playwright) : undefined;
    });
  const uiAuditor = new UiAuditor(fileSystem, workspace, prototypeStore, preview, browserDriver);
  const uiChecks: UiCheckPort = {
    audit: async (spec) => {
      const target = await prototypeStore.resolveTarget(spec);
      return target.isSuccess ? ok(toUiOutcome(await uiAuditor.audit(target.value))) : fail(target.error);
    },
  };
  const qaRunner = new QARunnerService(processRunner, fileSystem, uiChecks);
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
    lessons: new LessonAuthoring(fileSystem, workspace, journal, learningRepo, lessonFinder, library, projectName),
    profile: new ProfileService(fileSystem, {
      user: userProfileFile ? () => userProfileFile : undefined,
      project: () => workspace.hexagenPath('profile.json'),
    }),
    prototypes: { store: prototypeStore, preview, auditor: uiAuditor, promoter: new PrototypePromoter(fileSystem, workspace, journal, prototypeStore) },
    llm,
  };
}

/** Maps a UI audit onto QA's result vocabulary, so the learning loop treats it like any other check. */
function toUiOutcome(report: UiAuditReport): UiCheckOutcome {
  const details = (f: UiFinding) => ({
    ...(f.file ? { file: f.file } : {}),
    ...(f.line ? { line: f.line } : {}),
    testName: f.viewport ? `${f.rule} (${f.viewport}, ${f.theme})` : f.rule,
    errorMessage: f.selector ? `${f.message} [${f.selector}]` : f.message,
  });
  return {
    target: report.target,
    command: `hexacore ui ${report.target} (${report.rendered ? 'static + browser' : 'static'})`,
    total: report.rulesChecked.length,
    failures: report.findings.filter((f) => f.severity === 'error').map(details),
    warnings: report.findings.filter((f) => f.severity === 'warning').map(details),
    artifacts: report.screenshots,
    notes: report.renderSkipped ? [report.renderSkipped] : [],
    images: report.images,
  };
}
