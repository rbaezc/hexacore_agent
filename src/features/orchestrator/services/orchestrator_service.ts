import { Result, ok, fail } from '../../../shared/domain/result.js';
import { StateRepository } from '../../state_management/services/state_repository.js';
import { RagSearchEngine } from '../../rag_engine/services/rag_search_engine.js';
import { ScaffoldingService } from '../../scaffolding/services/scaffolding_service.js';
import { QAAutonomousLoop, CodePatcher } from '../../quality_assurance/services/qa_autonomous_loop.js';
import { TelemetryService } from '../../../shared/infrastructure/telemetry.js';
import { UserRequirement, OrchestrationResult, ExecutionStep } from '../domain/orchestrator_types.js';

export class HexaCoreOrchestrator {
  constructor(
    private readonly stateRepo: StateRepository,
    private readonly ragEngine: RagSearchEngine,
    private readonly scaffoldingService: ScaffoldingService,
    private readonly qaLoop: QAAutonomousLoop,
    private readonly patcher?: CodePatcher,
    private readonly telemetry: TelemetryService = new TelemetryService()
  ) {}

  async orchestrate(req: UserRequirement): Promise<Result<OrchestrationResult, Error>> {
    const planSpan = this.telemetry.startSpan('orchestrate_task', req.id);
    try {
      const planId = `plan_${Date.now()}`;
      const steps: ExecutionStep[] = [
        { id: `${planId}_1`, name: 'RAG Rule Injection', action: 'rag_inquire', status: 'pending' },
        { id: `${planId}_2`, name: 'Vertical Slice Scaffolding', action: 'scaffold', status: 'pending' },
        { id: `${planId}_3`, name: 'QA Loop Verification', action: 'qa_check', status: 'pending' },
      ];

      // Step 1: RAG Rule Extraction
      const ragSpan = this.telemetry.startSpan('rag_inquire', req.id);
      steps[0].status = 'in_progress';
      const ragRes = await this.ragEngine.searchRules(`${req.targetStack} ${req.sliceName} ${req.description}`);
      const injectedRules = ragRes.isSuccess ? ragRes.value.injectedContext : '';
      steps[0].status = 'completed';
      steps[0].output = `Injected ${ragRes.isSuccess ? ragRes.value.snippets.length : 0} rule snippets`;
      await this.telemetry.endSpan(ragSpan, 'SUCCESS', { sliceName: req.sliceName, snippetCount: ragRes.isSuccess ? ragRes.value.snippets.length : 0 });

      await this.stateRepo.addFact({
        key: `rules_${req.sliceName}`,
        value: injectedRules,
        category: 'config',
      });

      // Step 2: Scaffolding
      const scaffoldSpan = this.telemetry.startSpan('scaffold', req.id);
      steps[1].status = 'in_progress';
      const scaffoldRes = await this.scaffoldingService.executeScaffolding({
        stack: req.targetStack,
        sliceName: req.sliceName,
      });

      if (scaffoldRes.isFailure) {
        steps[1].status = 'failed';
        steps[1].output = scaffoldRes.error.message;
        await this.telemetry.endSpan(scaffoldSpan, 'FAILURE', { error: scaffoldRes.error.message });
        await this.telemetry.endSpan(planSpan, 'FAILURE', { planId, failedStep: steps[1].name });
        return fail(scaffoldRes.error);
      }

      steps[1].status = 'completed';
      steps[1].output = `Created ${scaffoldRes.value.createdFiles.length} files for ${req.sliceName}`;
      await this.telemetry.endSpan(scaffoldSpan, 'SUCCESS', { fileCount: scaffoldRes.value.createdFiles.length });

      await this.stateRepo.updateLedgerStep({
        id: steps[1].id,
        title: `Scaffold ${req.sliceName}`,
        description: `Created slice files for stack ${req.targetStack}`,
        status: 'completed',
        sliceName: req.sliceName,
        assignedAgent: 'ScaffoldingAgent',
        timestamp: new Date().toISOString(),
      });

      // Step 3: QA Verification with Auto-Healing
      const qaSpan = this.telemetry.startSpan('qa_check', req.id);
      steps[2].status = 'in_progress';
      const loopRes = await this.qaLoop.runAutonomousLoop({ stack: req.targetStack }, this.patcher);
      if (loopRes.isSuccess) {
        const qaSuccess = loopRes.value.finalResult.passed;
        steps[2].status = qaSuccess ? 'completed' : 'failed';
        steps[2].output = loopRes.value.attempts
          .map((a) => `iteration ${a.iteration}: ${a.status}`)
          .join('; ');
        await this.telemetry.endSpan(qaSpan, qaSuccess ? 'SUCCESS' : 'FAILURE', { attempts: loopRes.value.attempts.length });
      } else {
        steps[2].status = 'failed';
        steps[2].output = loopRes.error.message;
        await this.telemetry.endSpan(qaSpan, 'FAILURE', { error: loopRes.error.message });
      }

      const success = steps.every((s) => s.status === 'completed');
      await this.telemetry.endSpan(planSpan, success ? 'SUCCESS' : 'FAILURE', { planId });

      return ok({
        planId,
        requirement: req,
        injectedRules,
        steps,
        success,
        message: 'Orchestration pipeline execution completed.',
      });
    } catch (error: any) {
      await this.telemetry.endSpan(planSpan, 'FAILURE', { error: error.message });
      return fail(new Error(`Orchestration failed: ${error.message}`));
    }
  }
}
