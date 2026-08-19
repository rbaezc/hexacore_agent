import { ToolRegistry } from '../services/tool_registry.js';
import { StateRepository } from '../../state_management/services/state_repository.js';
import { RagSearchEngine } from '../../rag_engine/services/rag_search_engine.js';
import { ScaffoldingService } from '../../scaffolding/services/scaffolding_service.js';
import { QARunnerService } from '../../quality_assurance/services/qa_runner_service.js';
import { HexaCoreOrchestrator } from '../../orchestrator/services/orchestrator_service.js';

export function createToolRegistry(
  stateRepo: StateRepository,
  ragEngine: RagSearchEngine,
  scaffoldingService: ScaffoldingService,
  qaRunner: QARunnerService,
  orchestrator: HexaCoreOrchestrator
): ToolRegistry {
  const registry = new ToolRegistry();

  registry.registerTool({
    name: 'resume_session',
    description: 'Restores memory and session state from .hexagen/state.json manifest',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const res = await stateRepo.loadState();
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    },
  });

  registry.registerTool({
    name: 'search_knowledge_base',
    description: 'Searches architecture rules and conventions in /docs knowledge base',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Architecture search query' } },
      required: ['query'],
    },
    handler: async (args: { query: string }) => {
      const res = await ragEngine.searchRules(args.query);
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    },
  });

  registry.registerTool({
    name: 'execute_scaffolding',
    description: 'Creates Vertical Slice structure (domain, application, infrastructure, presentation) adhering to architecture policies',
    inputSchema: {
      type: 'object',
      properties: {
        stack: { type: 'string', enum: ['elixir', 'dotnet', 'node', 'laravel', 'rust', 'python', 'react', 'go', 'flutter', 'ruby', 'reactnative'] },
        sliceName: { type: 'string', description: 'Vertical slice name' },
        layer: {
          type: 'string',
          enum: ['domain', 'application', 'infrastructure', 'presentation', 'full'],
          description: 'Generate a single VSA layer, or the full slice (default: full)',
        },
      },
      required: ['stack', 'sliceName'],
    },
    handler: async (args: any) => {
      const res = await scaffoldingService.executeScaffolding(args);
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    },
  });

  registry.registerTool({
    name: 'run_quality_assurance',
    description: 'Runs environment test runner and parses test failures into JSON',
    inputSchema: {
      type: 'object',
      properties: {
        stack: { type: 'string', enum: ['elixir', 'dotnet', 'node', 'laravel', 'rust', 'python', 'react', 'go', 'flutter', 'ruby', 'reactnative'] },
        scope: { type: 'string' },
      },
      required: ['stack'],
    },
    handler: async (args: any) => {
      const res = await qaRunner.runQA(args);
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    },
  });

  registry.registerTool({
    name: 'orchestrate_task',
    description: 'Executes full autonomous Plan-and-Solve pipeline (RAG -> Scaffolding -> QA)',
    inputSchema: {
      type: 'object',
      properties: {
        description: { type: 'string' },
        targetStack: { type: 'string', enum: ['elixir', 'dotnet', 'node', 'laravel', 'rust', 'python', 'react', 'go', 'flutter', 'ruby', 'reactnative'] },
        sliceName: { type: 'string' },
      },
      required: ['description', 'targetStack', 'sliceName'],
    },
    handler: async (args: any) => {
      const res = await orchestrator.orchestrate({
        id: `req_${Date.now()}`,
        description: args.description,
        targetStack: args.targetStack,
        sliceName: args.sliceName,
      });
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    },
  });

  return registry;
}
