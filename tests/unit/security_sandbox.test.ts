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

  it('should not be fooled by a sibling directory that shares the root as a string prefix', () => {
    const result = SecuritySandboxGuard.validatePath('C:/Projects/hexacore_agent-evil/secret.ts', 'C:/Projects/hexacore_agent');
    expect(result.isFailure).toBe(true);
  });

  it('should allow spawning an allowlisted test-runner executable', () => {
    const result = SecuritySandboxGuard.validateInvocation('npx', ['vitest', 'run']);
    expect(result.isSuccess).toBe(true);
  });

  it('should reject spawning an executable outside the allowlist', () => {
    const result = SecuritySandboxGuard.validateInvocation('powershell', ['-Command', 'Remove-Item -Recurse -Force C:\\']);
    expect(result.isFailure).toBe(true);
  });

  it('should reject an allowlisted executable invoked with a dangerous argument pattern', () => {
    const result = SecuritySandboxGuard.validateInvocation('bundle', ['exec', 'rspec', '&&', 'rm', '-rf', '/']);
    expect(result.isFailure).toBe(true);
  });
});
