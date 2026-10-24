import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { createTestHexaCore, TEST_ROOT } from '../helpers/test_hexacore.js';

describe('HexaCoreOrchestrator', () => {
  it('runs rules → scaffold (per slice) → architecture → QA and persists the plan', async () => {
    const { services, fs } = createTestHexaCore([0]);

    const result = await services.orchestrator.orchestrate({
      id: 'req_1',
      description: 'Orders and invoices',
      targetStack: 'node',
      slices: [{ name: 'orders' }, { name: 'invoices' }],
    });

    expect(result.isSuccess).toBe(true);
    if (!result.isSuccess) return;
    expect(result.value.steps.map((s) => s.kind)).toEqual(['rag', 'scaffold', 'scaffold', 'architecture', 'qa']);
    expect(result.value.success).toBe(true);
    expect(await fs.exists(path.join(TEST_ROOT, 'src/features/invoices/index.ts'))).toBe(true);

    const persisted = await services.stateRepo.getPlan(result.value.planId);
    expect(persisted.isSuccess && persisted.value.status).toBe('completed');
  });

  it('stops on a scaffold conflict, then resume_plan continues once it is resolved', async () => {
    const { services, fs } = createTestHexaCore([0]);
    const conflicting = path.join(TEST_ROOT, 'src/features/orders/domain/orders_entity.ts');
    await fs.writeFile(conflicting, '// mine');

    const first = await services.orchestrator.orchestrate({ id: 'r', description: 'orders', targetStack: 'node', sliceName: 'orders' });
    expect(first.isSuccess).toBe(true);
    if (!first.isSuccess) return;
    expect(first.value.success).toBe(false);
    expect(first.value.steps[1].status).toBe('failed');
    expect(first.value.nextActions.join(' ')).toContain('resume_plan');

    await fs.remove(conflicting);
    const resumed = await services.orchestrator.resume(first.value.planId);
    expect(resumed.isSuccess && resumed.value.success).toBe(true);
  });

  it('reports failing tests with nextActions when no auto-fixer is available', async () => {
    const { services } = createTestHexaCore([1]);
    const result = await services.orchestrator.orchestrate({ id: 'r', description: 'orders', targetStack: 'node', sliceName: 'orders' });
    expect(result.isSuccess).toBe(true);
    if (!result.isSuccess) return;
    expect(result.value.success).toBe(false);
    expect(result.value.qa[0].failedTestsCount).toBe(1);
    expect(result.value.nextActions.join(' ')).toContain('no auto-fixer');
  });

  it('auto-fixes through the client model (sampling) and goes green', async () => {
    const { services } = createTestHexaCore([1, 0]);
    services.llm.client = {
      async complete() {
        return JSON.stringify({
          explanation: 'Accept ids with whitespace trimmed',
          edits: [{ file: 'src/features/orders/application/orders_handler.ts', search: 'if (!input.id) {', replace: 'if (!input.id.trim()) {' }],
        });
      },
    };
    const result = await services.orchestrator.orchestrate({ id: 'r', description: 'orders', targetStack: 'node', sliceName: 'orders' });
    expect(result.isSuccess).toBe(true);
    if (!result.isSuccess) return;
    expect(result.value.success).toBe(true);
    expect(result.value.qaAttempts.map((a) => a.status)).toEqual(['failed', 'patched', 'passed']);
  });
});
