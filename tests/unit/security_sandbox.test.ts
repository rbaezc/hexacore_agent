import { describe, it, expect } from 'vitest';
import { SecuritySandboxGuard } from '../../src/shared/infrastructure/security_sandbox.js';

describe('SecuritySandboxGuard', () => {
  it('should block dangerous shell commands', () => {
    const result = SecuritySandboxGuard.validateCommand('rm -rf /var/www');
    expect(result.isFailure).toBe(true);
    if (result.isFailure) {
      expect(result.error.message).toContain('Security Violation');
    }
  });

  it('should block path traversal outside root workspace', () => {
    const result = SecuritySandboxGuard.validatePath('../../../Windows/System32', 'C:/Projects/VortexSolutions/hexacore_agent');
    expect(result.isFailure).toBe(true);
  });

  it('should allow valid workspace paths', () => {
    const result = SecuritySandboxGuard.validatePath('C:/Projects/VortexSolutions/hexacore_agent/src/index.ts', 'C:/Projects/VortexSolutions/hexacore_agent');
    expect(result.isSuccess).toBe(true);
  });
});
