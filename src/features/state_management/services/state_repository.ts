import * as path from 'node:path';
import { IFileSystem } from '../../../shared/infrastructure/file_system.js';
import { Result, ok, fail } from '../../../shared/domain/result.js';
import { StateManifest, LedgerStep, CaseFact } from '../domain/state_types.js';
import { StateValidator } from '../domain/state_validator.js';
import { AtomicFileWriter } from './atomic_file_writer.js';

export class StateRepository {
  private readonly manifestPath: string;

  constructor(
    private readonly fileSystem: IFileSystem,
    baseDir: string = process.cwd()
  ) {
    this.manifestPath = path.join(baseDir, '.hexagen', 'state.json');
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
      return await AtomicFileWriter.writeAtomic(this.manifestPath, content);
    } catch (error: any) {
      return fail(new Error(`Failed to save state manifest: ${error.message}`));
    }
  }

  async addFact(fact: Omit<CaseFact, 'updatedAt'>): Promise<Result<StateManifest, Error>> {
    const loadResult = await this.loadState();
    if (loadResult.isFailure) return loadResult;

    const state = loadResult.value;
    const existingIndex = state.facts.findIndex((f) => f.key === fact.key);
    const newFact: CaseFact = { ...fact, updatedAt: new Date().toISOString() };

    if (existingIndex >= 0) {
      state.facts[existingIndex] = newFact;
    } else {
      state.facts.push(newFact);
    }

    const saveResult = await this.saveState(state);
    if (saveResult.isFailure) return fail(saveResult.error);
    return ok(state);
  }

  async updateLedgerStep(step: LedgerStep): Promise<Result<StateManifest, Error>> {
    const loadResult = await this.loadState();
    if (loadResult.isFailure) return loadResult;

    const state = loadResult.value;
    const existingIndex = state.ledger.findIndex((s) => s.id === step.id);

    if (existingIndex >= 0) {
      state.ledger[existingIndex] = step;
    } else {
      state.ledger.push(step);
    }

    const saveResult = await this.saveState(state);
    if (saveResult.isFailure) return fail(saveResult.error);
    return ok(state);
  }

  private createDefaultManifest(): StateManifest {
    return {
      metadata: {
        projectName: 'HexaCore Application',
        activeStacks: ['node'],
        version: '1.0.0',
        lastUpdated: new Date().toISOString(),
      },
      facts: [],
      ledger: [],
    };
  }
}
