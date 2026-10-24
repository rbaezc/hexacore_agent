import * as path from 'node:path';
import { IFileSystem } from '../../../shared/infrastructure/file_system.js';
import { WorkspaceContext } from '../../../shared/infrastructure/workspace.js';
import { Result, ok, fail } from '../../../shared/domain/result.js';
import { StateManifest, LedgerStep, CaseFact, ExecutionPlan, DecisionRecord, HandoffNote, QaRunSummary } from '../domain/state_types.js';
import { StateValidator } from '../domain/state_validator.js';

const MAX_QA_HISTORY = 50;
const MAX_HANDOFFS = 20;

export class StateRepository {
  private readonly workspace: WorkspaceContext;
  /** Serializes read-modify-write sequences so concurrent writers can't clobber each other. */
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly fileSystem: IFileSystem,
    workspaceOrBaseDir: WorkspaceContext | string = new WorkspaceContext()
  ) {
    this.workspace = typeof workspaceOrBaseDir === 'string' ? new WorkspaceContext(workspaceOrBaseDir) : workspaceOrBaseDir;
  }

  private get manifestPath(): string {
    return this.workspace.hexagenPath('state.json');
  }

  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(fn, fn);
    this.writeQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async loadState(): Promise<Result<StateManifest, Error>> {
    try {
      const exists = await this.fileSystem.exists(this.manifestPath);
      if (!exists) {
        const initialState = this.createDefaultManifest();
        await this.saveState(initialState);
        return ok(initialState);
      }
      const raw = await this.fileSystem.readFile(this.manifestPath);
      const parsed = JSON.parse(raw);
      const validationResult = StateValidator.validate(parsed);
      if (validationResult.isFailure) return fail(validationResult.error);
      return ok(validationResult.value);
    } catch (error: any) {
      return fail(new Error(`Failed to load state manifest: ${error.message}`));
    }
  }

  async saveState(state: StateManifest): Promise<Result<void, Error>> {
    try {
      state.metadata.lastUpdated = new Date().toISOString();
      const content = JSON.stringify(state, null, 2);
      await this.fileSystem.writeFileAtomic(this.manifestPath, content);
      return ok(undefined);
    } catch (error: any) {
      return fail(new Error(`Failed to save state manifest: ${error.message}`));
    }
  }

  /** Atomic read-modify-write under the in-process lock. */
  async update(mutate: (state: StateManifest) => void): Promise<Result<StateManifest, Error>> {
    return this.withLock(async () => {
      const loadResult = await this.loadState();
      if (loadResult.isFailure) return loadResult;
      const state = loadResult.value;
      mutate(state);
      const saveResult = await this.saveState(state);
      if (saveResult.isFailure) return fail(saveResult.error);
      return ok(state);
    });
  }

  async addFact(fact: Omit<CaseFact, 'updatedAt'>): Promise<Result<StateManifest, Error>> {
    return this.update((state) => upsert(state.facts, { ...fact, updatedAt: new Date().toISOString() }, (f) => f.key === fact.key));
  }

  async updateLedgerStep(step: LedgerStep): Promise<Result<StateManifest, Error>> {
    return this.update((state) => upsert(state.ledger, step, (s) => s.id === step.id));
  }

  async savePlan(plan: ExecutionPlan): Promise<Result<StateManifest, Error>> {
    plan.updatedAt = new Date().toISOString();
    return this.update((state) => upsert(state.plans, structuredClone(plan), (p) => p.id === plan.id));
  }

  async getPlan(planId: string): Promise<Result<ExecutionPlan, Error>> {
    const loaded = await this.loadState();
    if (loaded.isFailure) return fail(loaded.error);
    const plan = loaded.value.plans.find((p) => p.id === planId);
    return plan ? ok(plan) : fail(new Error(`Plan '${planId}' not found in .hexagen/state.json.`));
  }

  async addDecision(decision: DecisionRecord): Promise<Result<StateManifest, Error>> {
    return this.update((state) => upsert(state.decisions, decision, (d) => d.id === decision.id));
  }

  async addHandoff(note: HandoffNote): Promise<Result<StateManifest, Error>> {
    return this.update((state) => {
      state.handoffs.push(note);
      state.handoffs = state.handoffs.slice(-MAX_HANDOFFS);
    });
  }

  async recordQaRun(summary: QaRunSummary): Promise<Result<StateManifest, Error>> {
    return this.update((state) => {
      state.qaHistory.push(summary);
      state.qaHistory = state.qaHistory.slice(-MAX_QA_HISTORY);
    });
  }

  private createDefaultManifest(): StateManifest {
    return {
      metadata: {
        projectName: path.basename(this.workspace.root) || 'HexaCore Application',
        activeStacks: [],
        version: '1.0.0',
        lastUpdated: new Date().toISOString(),
      },
      facts: [],
      ledger: [],
      plans: [],
      decisions: [],
      handoffs: [],
      qaHistory: [],
    };
  }
}

function upsert<T>(list: T[], item: T, match: (existing: T) => boolean): void {
  const index = list.findIndex(match);
  if (index >= 0) list[index] = item;
  else list.push(item);
}
