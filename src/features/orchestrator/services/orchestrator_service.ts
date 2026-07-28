import { Result, ok, fail } from '../../../shared/domain/result.js';
import { StateRepository } from '../../state_management/services/state_repository.js';
import { RagSearchEngine } from '../../rag_engine/services/rag_search_engine.js';
import { ScaffoldingService } from '../../scaffolding/services/scaffolding_service.js';
import { QARunnerService } from '../../quality_assurance/services/qa_runner_service.js';
import { UserRequirement, OrchestrationResult, ExecutionStep } from '../domain/orchestrator_types.js';

export class HexaCoreOrchestrator {
  constructor(
    private readonly stateRepo: StateRepository,
    private readonly ragEngine: RagSearchEngine,
    private readonly scaffoldingService: ScaffoldingService,
    private readonly qaRunner: QARunnerService
  ) {}

  async orchestrate(req: UserRequirement): Promise<Result<OrchestrationResult, Error>> {
    try {
      const planId = `plan_${Date.now()}`;
      const steps: ExecutionStep[] = [
        { id: `${planId}_1`, name: 'RAG Rule Injection', action: 'rag_inquire', status: 'pending' },
        { id: `${planId}_2`, name: 'Vertical Slice Scaffolding', action: 'scaffold', status: 'pending' },
        { id: `${planId}_3`, name: 'QA Loop Verification', action: 'qa_check', status: 'pending' },
      ];

      // Step 1: RAG Rule Extraction
      steps[0].status = 'in_progress';
      const ragRes = await this.ragEngine.searchRules(`${req.targetStack} ${req.sliceName} ${req.description}`);
      const injectedRules = ragRes.isSuccess ? ragRes.value.injectedContext : '';
      steps[0].status = 'completed';
      steps[0].output = `Injected ${ragRes.isSuccess ? ragRes.value.snippets.length : 0} rule snippets`;

      await this.stateRepo.addFact({
        key: `rules_${req.sliceName}`,
        value: injectedRules,
        category: 'config',
      });

      // Step 2: Scaffolding
      steps[1].status = 'in_progress';
      const scaffoldRes = await this.scaffoldingService.executeScaffolding({
        stack: req.targetStack,
        sliceName: req.sliceName,
      });

      if (scaffoldRes.isFailure) {
        steps[1].status = 'failed';
        steps[1].output = scaffoldRes.error.message;
        return fail(scaffoldRes.error);
      }

      steps[1].status = 'completed';
      steps[1].output = `Created ${scaffoldRes.value.createdFiles.length} files for ${req.sliceName}`;

      await this.stateRepo.updateLedgerStep({
        id: steps[1].id,
        title: `Scaffold ${req.sliceName}`,
        description: `Created slice files for stack ${req.targetStack}`,
        status: 'completed',
        sliceName: req.sliceName,
        assignedAgent: 'ScaffoldingAgent',
        timestamp: new Date().toISOString(),
      });

      // Step 3: QA Verification
      steps[2].status = 'in_progress';
      const qaRes = await this.qaRunner.runQA({ stack: req.targetStack });
      const qaSuccess = qaRes.isSuccess && qaRes.value.passed;
      steps[2].status = qaSuccess ? 'completed' : 'failed';
      steps[2].output = qaRes.isSuccess ? (qaSuccess ? 'All QA tests passed' : 'QA tests failed') : qaRes.error.message;

      return ok({
        planId,
        requirement: req,
        injectedRules,
        steps,
        success: steps.every((s) => s.status === 'completed'),
        message: 'Orchestration pipeline execution completed.',
      });
    } catch (error: any) {
      return fail(new Error(`Orchestration failed: ${error.message}`));
    }
  }
}
