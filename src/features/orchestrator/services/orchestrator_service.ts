import { Result, ok, fail } from '../../../shared/domain/result.js';
import { TelemetryService } from '../../../shared/infrastructure/telemetry.js';
import { WorkspaceContext } from '../../../shared/infrastructure/workspace.js';
import { StateRepository, ExecutionPlan, PlanStep } from '../../state_management/index.js';
import { RagSearchEngine } from '../../rag_engine/index.js';
import { ScaffoldingService } from '../../scaffolding/index.js';
import { QARunnerService, QAAutonomousLoop, CodePatcher, QAFixAttempt, QAResult } from '../../quality_assurance/index.js';
import { ArchitectureChecker, ArchitectureViolation } from '../../architecture/index.js';
import { UserRequirement, OrchestrationResult } from '../domain/orchestrator_types.js';

export interface OrchestratorDeps {
  stateRepo: StateRepository;
  ragEngine: RagSearchEngine;
  scaffolding: ScaffoldingService;
  qaRunner: QARunnerService;
  qaLoop: QAAutonomousLoop;
  architecture: ArchitectureChecker;
  workspace: WorkspaceContext;
  telemetry?: TelemetryService;
  /** Resolved per run: a patcher exists only while the connected client supports sampling. */
  patcherFactory?: () => CodePatcher | undefined;
}

interface RunContext {
  rules: string;
  qa: QAResult[];
  attempts: QAFixAttempt[];
  violations: ArchitectureViolation[];
  nextActions: string[];
}

/**
 * Plan-and-execute pipeline. The client model plans (decomposes a requirement into slices);
 * HexaCore executes each step deterministically, persists progress after every step, and can
 * resume a plan from its first unfinished step.
 */
export class HexaCoreOrchestrator {
  private readonly telemetry: TelemetryService;

  constructor(private readonly deps: OrchestratorDeps) {
    this.telemetry = deps.telemetry ?? new TelemetryService();
  }

  async orchestrate(req: UserRequirement): Promise<Result<OrchestrationResult, Error>> {
    const slices = req.slices?.length ? req.slices : req.sliceName ? [{ name: req.sliceName, description: req.description }] : [];
    if (slices.length === 0) return fail(new Error('Provide at least one slice (slices[] or sliceName).'));

    const now = new Date().toISOString();
    const planId = `plan_${Date.now()}`;
    const step = (suffix: string, kind: PlanStep['kind'], title: string, sliceName?: string): PlanStep => ({
      id: `${planId}_${suffix}`,
      kind,
      title,
      sliceName,
      status: 'pending',
      updatedAt: now,
    });

    const plan: ExecutionPlan = {
      id: planId,
      description: req.description,
      stack: req.targetStack,
      targetDir: req.targetDir,
      slices,
      qaChecks: req.qaChecks?.length ? req.qaChecks : ['test'],
      overwrite: req.overwrite,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      steps: [
        step('rag', 'rag', 'Retrieve architecture rules'),
        ...slices.map((s, i) => step(`scaffold_${i + 1}`, 'scaffold', `Scaffold slice '${s.name}'`, s.name)),
        step('architecture', 'architecture', 'Verify VSA architecture rules'),
        step('qa', 'qa', `Quality checks: ${(req.qaChecks?.length ? req.qaChecks : ['test']).join(', ')}`),
      ],
    };
    const saved = await this.deps.stateRepo.savePlan(plan);
    if (saved.isFailure) return fail(saved.error);
    return this.execute(plan, req.autoFix, req.id);
  }

  /** Continues a persisted plan from its first unfinished step. */
  async resume(planId: string, autoFix?: boolean): Promise<Result<OrchestrationResult, Error>> {
    const plan = await this.deps.stateRepo.getPlan(planId);
    if (plan.isFailure) return fail(plan.error);
    if (plan.value.status === 'completed') return fail(new Error(`Plan '${planId}' is already completed.`));
    return this.execute(plan.value, autoFix, planId);
  }

  private async execute(plan: ExecutionPlan, autoFix: boolean | undefined, correlationId: string): Promise<Result<OrchestrationResult, Error>> {
    const planSpan = this.telemetry.startSpan('orchestrate_task', correlationId);
    const ctx: RunContext = { rules: '', qa: [], attempts: [], violations: [], nextActions: [] };
    plan.status = 'in_progress';

    try {
      for (const step of plan.steps) {
        // Rules are always re-read: the auto-fixer needs them even when the step completed earlier.
        if (step.status === 'completed' && step.kind !== 'rag') continue;
        await this.mark(plan, step, 'in_progress');
        const span = this.telemetry.startSpan(step.kind, correlationId);
        const outcome = await this.runStep(plan, step, ctx, autoFix);
        step.output = outcome.output;
        step.checkpointId = outcome.checkpointId ?? step.checkpointId;
        await this.mark(plan, step, outcome.ok ? 'completed' : 'failed');
        await this.telemetry.endSpan(span, outcome.ok ? 'SUCCESS' : 'FAILURE', { step: step.title });
        if (!outcome.ok && step.kind === 'scaffold') {
          ctx.nextActions.push(`Resolve the problem above, then call resume_plan with planId '${plan.id}'.`);
          break;
        }
      }

      const success = plan.steps.every((s) => s.status === 'completed');
      plan.status = success ? 'completed' : 'failed';
      await this.deps.stateRepo.savePlan(plan);
      await this.telemetry.endSpan(planSpan, success ? 'SUCCESS' : 'FAILURE', { planId: plan.id });

      return ok({
        planId: plan.id,
        plan,
        injectedRules: ctx.rules,
        steps: plan.steps,
        success,
        qa: ctx.qa,
        qaAttempts: ctx.attempts,
        architectureViolations: ctx.violations.slice(0, 20),
        nextActions: ctx.nextActions,
        message: success ? `Plan ${plan.id} completed: all steps green.` : `Plan ${plan.id} stopped with failures; see steps and nextActions.`,
      });
    } catch (error: any) {
      plan.status = 'failed';
      await this.deps.stateRepo.savePlan(plan);
      await this.telemetry.endSpan(planSpan, 'FAILURE', { error: error.message });
      return fail(new Error(`Orchestration failed: ${error.message}`));
    }
  }

  private async runStep(plan: ExecutionPlan, step: PlanStep, ctx: RunContext, autoFix?: boolean): Promise<{ ok: boolean; output: string; checkpointId?: string }> {
    switch (step.kind) {
      case 'rag': {
        const query = `${plan.stack} ${plan.description} ${plan.slices.map((s) => `${s.name} ${s.description ?? ''}`).join(' ')}`;
        const rag = await this.deps.ragEngine.searchRules(query, 5);
        ctx.rules = rag.isSuccess ? rag.value.injectedContext : '';
        return { ok: true, output: rag.isSuccess ? `Injected ${rag.value.snippets.length} rule snippet(s).` : `RAG unavailable: ${rag.error.message}` };
      }
      case 'scaffold': {
        const slice = plan.slices.find((s) => s.name === step.sliceName)!;
        const res = await this.deps.scaffolding.executeScaffolding({
          stack: plan.stack,
          sliceName: slice.name,
          layer: slice.layer,
          targetDir: plan.targetDir,
          overwrite: plan.overwrite,
        });
        if (res.isFailure) return { ok: false, output: res.error.message };
        ctx.nextActions.push(...res.value.notes);
        return { ok: true, output: res.value.message, checkpointId: res.value.checkpointId };
      }
      case 'architecture': {
        const report = await this.deps.architecture.check(plan.targetDir ?? '.');
        if (report.isFailure) return { ok: false, output: report.error.message };
        ctx.violations = report.value.violations;
        if (!report.value.passed) ctx.nextActions.push('Fix the architecture violations (see architectureViolations), then re-run check_architecture.');
        return { ok: report.value.passed, output: `${report.value.errorCount} error(s), ${report.value.warningCount} warning(s) across ${report.value.filesScanned} file(s).` };
      }
      case 'qa':
        return this.runQa(plan, ctx, autoFix);
    }
  }

  private async runQa(plan: ExecutionPlan, ctx: RunContext, autoFix?: boolean): Promise<{ ok: boolean; output: string }> {
    const cwd = this.deps.workspace.resolveInside(plan.targetDir ?? '.');
    if (cwd.isFailure) return { ok: false, output: cwd.error.message };
    const options = { stack: plan.stack, cwd: cwd.value };

    if (plan.qaChecks.includes('test')) {
      const patcher = autoFix === false ? undefined : this.deps.patcherFactory?.();
      const loop = await this.deps.qaLoop.runAutonomousLoop(options, patcher, ctx.rules);
      if (loop.isFailure) return { ok: false, output: loop.error.message };
      ctx.qa.push(loop.value.finalResult);
      ctx.attempts = loop.value.attempts;
      if (!loop.value.finalResult.passed && !patcher) {
        ctx.nextActions.push('Tests are failing and no auto-fixer is available (client lacks MCP sampling): fix the failures listed in qa[], then call run_quality_assurance.');
      }
    }
    const others = plan.qaChecks.filter((c) => c !== 'test');
    if (others.length > 0) {
      const results = await this.deps.qaRunner.runChecks(options, others);
      if (results.isFailure) return { ok: false, output: results.error.message };
      ctx.qa.push(...results.value);
    }

    for (const r of ctx.qa) {
      await this.deps.stateRepo.recordQaRun({ stack: r.stack, check: r.check, status: r.status, failed: r.failedTestsCount, total: r.totalTests, at: new Date().toISOString() });
    }
    const failed = ctx.qa.filter((r) => r.status === 'failed');
    const skipped = ctx.qa.filter((r) => r.status === 'skipped');
    if (skipped.length) ctx.nextActions.push(`Skipped checks (not verified): ${skipped.map((s) => `${s.check} — ${s.skipReason}`).join('; ')}`);
    const summary = ctx.qa.map((r) => `${r.check}: ${r.status}${r.status === 'failed' ? ` (${r.failedTestsCount} failing)` : ''}`).join(', ');
    // A skipped test check means nothing was verified; that's not a green run.
    const testSkipped = ctx.qa.some((r) => r.check === 'test' && r.status === 'skipped');
    return { ok: failed.length === 0 && !testSkipped, output: summary };
  }

  private async mark(plan: ExecutionPlan, step: PlanStep, status: PlanStep['status']): Promise<void> {
    step.status = status;
    step.updatedAt = new Date().toISOString();
    await this.deps.stateRepo.savePlan(plan);
  }
}
