import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
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
import { TelemetryLogWriter } from '../shared/infrastructure/telemetry_log_writer.js';
import { getPackageVersion } from '../shared/infrastructure/package_info.js';

/** Parses trailing `--flag value` pairs, e.g. `--targetDir /foo --layer domain`. */
function parseFlags(rest: string[]): { targetDir?: string; layer?: string } {
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]?.replace(/^--/, '');
    const value = rest[i + 1];
    if (key && value) flags[key] = value;
  }
  return flags;
}

export async function runHexaCoreCLI(args: string[]): Promise<void> {
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

  const command = args[0] || 'help';

  console.log('==================================================');
  console.log(`   HexaCore Agent Enterprise CLI (v${getPackageVersion()})`);
  console.log('==================================================');

  switch (command) {
    case 'state': {
      const state = await stateRepo.loadState();
      console.log(JSON.stringify(state, null, 2));
      break;
    }
    case 'rag': {
      const query = args.slice(1).join(' ') || 'vertical slice rules';
      const rag = await ragEngine.searchRules(query);
      console.log(JSON.stringify(rag, null, 2));
      break;
    }
    case 'scaffold': {
      const stack = (args[1] as any) || 'node';
      const sliceName = args[2] || 'payment';
      const flags = parseFlags(args.slice(3));
      const scaffold = await scaffoldingService.executeScaffolding({
        stack,
        sliceName,
        targetDir: flags.targetDir,
        layer: flags.layer as any,
      });
      console.log(JSON.stringify(scaffold, null, 2));
      break;
    }
    case 'orchestrate': {
      const sliceName = args[1] || 'auth';
      const stack = (args[2] as any) || 'node';
      const res = await orchestrator.orchestrate({
        id: `cli_${Date.now()}`,
        description: `Create ${sliceName} slice`,
        targetStack: stack,
        sliceName,
      });
      console.log(JSON.stringify(res, null, 2));
      break;
    }
    default: {
      console.log('Command Usage:');
      console.log('  npm start state                    -> Displays .hexagen/state.json manifest');
      console.log('  npm start rag <query>             -> Performs local BM25 semantic rule search');
      console.log('  npm start scaffold <stack> <name> [--targetDir <path>] [--layer <layer>] -> Scaffolds a new Vertical Slice');
      console.log('  npm start orchestrate <name>      -> Executes full Plan-and-Solve pipeline');
    }
  }
}

// Compares resolved absolute paths (not raw strings) so this matches regardless of
// relative-vs-absolute argv, drive-letter casing, or path separators on Windows.
const isMainModule = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  runHexaCoreCLI(process.argv.slice(2)).catch((err) => {
    console.error('CLI Error:', err);
    process.exit(1);
  });
}
