import { describe, it, expect } from 'vitest';
import { blueprintFor, selectFiles, DEFAULT_PROFILE } from '../../src/features/scaffolding/generators/stack_generators.js';
import { deriveSliceNames } from '../../src/shared/domain/slice_names.js';
import { SlicePolicyLinter } from '../../src/features/scaffolding/services/slice_policy_linter.js';
import { SUPPORTED_STACKS } from '../../src/features/state_management/domain/state_types.js';

const names = (raw: string) => {
  const r = deriveSliceNames(raw);
  if (r.isFailure) throw r.error;
  return r.value;
};

describe('slice names', () => {
  it('derives every spelling from kebab, snake or camel input', () => {
    for (const raw of ['user-profile', 'user_profile', 'userProfile', 'UserProfile']) {
      expect(names(raw)).toMatchObject({ snake: 'user_profile', pascal: 'UserProfile', camel: 'userProfile', kebab: 'user-profile', flat: 'userprofile' });
    }
  });
});

describe('stack generators', () => {
  for (const stack of SUPPORTED_STACKS) {
    it(`${stack}: full slice covers 4 layers + module + tests, within policy`, () => {
      const blueprint = blueprintFor(stack, names('user-profile'), { ...DEFAULT_PROFILE, dotnetTestProjectDir: 'tests/App.Tests', dotnetTestNamespace: 'App.Tests' });
      const files = selectFiles(blueprint);

      for (const layer of ['domain', 'application', 'infrastructure', 'presentation'] as const) {
        expect(blueprint.layers[layer].length, `${stack} ${layer}`).toBeGreaterThan(0);
      }
      const hasTests = blueprint.tests.length > 0 || files.some((f) => f.content.includes('#[cfg(test)]'));
      expect(hasTests, `${stack} has tests`).toBe(true);
      expect(SlicePolicyLinter.lintGeneratedFiles(files)).toEqual([]);
      expect(new Set(files.map((f) => f.path)).size).toBe(files.length);

      // No un-substituted template fragments and no hyphenated identifiers leaked.
      for (const f of files) {
        expect(f.content, f.path).not.toMatch(/\$\{|User-profile|user-profileEntity|\[object Object\]/);
        expect(f.path, f.path).not.toMatch(/\s/);
      }
    });
  }

  it('omits the vitest import for jest projects and the .js suffix for bundler resolution', () => {
    const files = selectFiles(blueprintFor('react', names('cart'), { ...DEFAULT_PROFILE, jsTestRunner: 'jest', jsImportExtension: '' }));
    const test = files.find((f) => f.role === 'test')!;
    expect(test.content).not.toContain("from 'vitest'");
    expect(test.content).toContain("from '../application/cart_service'");
  });
});
