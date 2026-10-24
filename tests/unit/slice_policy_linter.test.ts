import { describe, it, expect } from 'vitest';
import { SlicePolicyLinter } from '../../src/features/scaffolding/services/slice_policy_linter.js';

describe('SlicePolicyLinter', () => {
  it('flags generated files exceeding the maximum line count', () => {
    const violations = SlicePolicyLinter.lintGeneratedFiles([
      { path: 'src/features/order/large.ts', content: Array(300).fill('const x = 1;').join('\n') },
      { path: 'src/features/order/small.ts', content: 'const ok = true;' },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('MAX_LINE_COUNT_EXCEEDED');
  });

  it('flags horizontal cross-slice imports', () => {
    const violations = SlicePolicyLinter.lintGeneratedFiles([{ path: 'a.ts', content: "import x from '../../../features/billing/x.js';" }]);
    expect(violations[0].rule).toBe('HORIZONTAL_SLICE_COUPLING');
  });
});
