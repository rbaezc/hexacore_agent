import { NodeFileSystem } from '../shared/infrastructure/file_system.js';
import { NodeProcessRunner } from '../shared/infrastructure/process_runner.js';
import { ResilientProcessRunner } from '../shared/infrastructure/circuit_breaker.js';
import { StateRepository } from '../features/state_management/services/state_repository.js';
import { RagSearchEngine } from '../features/rag_engine/services/rag_search_engine.js';
import { ScaffoldingService } from '../features/scaffolding/services/scaffolding_service.js';
import { QARunnerService } from '../features/quality_assurance/services/qa_runner_service.js';
import { HexaCoreOrchestrator } from '../features/orchestrator/services/orchestrator_service.js';

export async function runHexaCoreCLI(args: string[]): Promise<void> {
  const fileSystem = new NodeFileSystem();
  const innerRunner = new NodeProcessRunner();
  const processRunner = new ResilientProcessRunner(innerRunner);

  const stateRepo = new StateRepository(fileSystem);
  const ragEngine = new RagSearchEngine(fileSystem);
  const scaffoldingService = new ScaffoldingService(fileSystem);
  const qaRunner = new QARunnerService(processRunner);
  const orchestrator = new HexaCoreOrchestrator(stateRepo, ragEngine, scaffoldingService, qaRunner);

  const command = args[0] || 'help';

  console.log('==================================================');
  console.log('   HexaCore Agent Enterprise CLI (v1.0.0)');
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
      const scaffold = await scaffoldingService.executeScaffolding({ stack, sliceName });
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
      console.log('  npm start scaffold <stack> <name> -> Scaffolds a new Vertical Slice');
      console.log('  npm start orchestrate <name>      -> Executes full Plan-and-Solve pipeline');
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runHexaCoreCLI(process.argv.slice(2)).catch((err) => {
    console.error('CLI Error:', err);
    process.exit(1);
  });
}
