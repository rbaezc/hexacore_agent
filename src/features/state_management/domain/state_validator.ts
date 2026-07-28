import { StateManifest } from './state_types.js';
import { Result, ok, fail } from '../../../shared/domain/result.js';

export class StateValidator {
  static validate(data: unknown): Result<StateManifest, Error> {
    if (typeof data !== 'object' || data === null) {
      return fail(new Error('State manifest must be a non-null object.'));
    }

    const obj = data as any;
    if (!obj.metadata || typeof obj.metadata.projectName !== 'string' || !Array.isArray(obj.metadata.activeStacks)) {
      return fail(new Error('Invalid state manifest metadata schema.'));
    }

    if (!Array.isArray(obj.facts) || !Array.isArray(obj.ledger)) {
      return fail(new Error('State manifest facts and ledger must be arrays.'));
    }

    return ok(obj as StateManifest);
  }
}
