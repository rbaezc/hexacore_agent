import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { createTestHexaCore, TEST_ROOT } from '../helpers/test_hexacore.js';
import { buildBriefing } from '../../src/features/state_management/services/session_briefing.js';
import { StackDetector } from '../../src/features/mcp_server/infrastructure/stack_detector.js';
import { InMemoryFileSystem } from '../helpers/in_memory_fs.js';

describe('DecisionRecorder', () => {
  it('numbers ADRs sequentially, indexes them in state, and makes them searchable', async () => {
    const { services, fs } = createTestHexaCore();
    const first = await services.decisions.record({ title: 'Usar PostgreSQL para pedidos', context: 'Necesitamos transacciones.', decision: 'PostgreSQL con FK obligatorias.', consequences: 'Más operación.' });
    const second = await services.decisions.record({ title: 'Events between slices', context: 'Decoupling.', decision: 'Domain events.', consequences: 'Eventual consistency.', alternatives: ['Direct calls'] });

    expect(first.isSuccess && first.value.file).toBe('docs/adr/0001-usar-postgresql-para-pedidos.md');
    expect(second.isSuccess && second.value.number).toBe(2);
    const adr = await fs.readFile(path.join(TEST_ROOT, 'docs/adr/0002-events-between-slices.md'));
    expect(adr).toContain('## Alternatives Considered');

    const state = await services.stateRepo.loadState();
    expect(state.isSuccess && state.value.decisions).toHaveLength(2);

    const search = await services.ragEngine.searchRules('base de datos pedidos');
    expect(search.isSuccess && search.value.snippets[0]?.source).toBe('decision');
  });
});

describe('ContractDesigner', () => {
  it('writes an OpenAPI 3.1 contract with schemas and path parameters', async () => {
    const { services } = createTestHexaCore();
    const res = await services.contracts.define({
      sliceName: 'orders',
      operations: [
        { method: 'POST', path: '/', summary: 'Create order', request: [{ name: 'id', type: 'string' }, { name: 'total', type: 'number' }], response: [{ name: 'createdAt', type: 'datetime' }] },
        { method: 'GET', path: '/{id}', summary: 'Get "order"' },
      ],
    });
    expect(res.isSuccess).toBe(true);
    if (!res.isSuccess) return;
    expect(res.value.file).toBe('contracts/orders.openapi.yaml');
    expect(res.value.yaml).toContain('openapi: 3.1.0');
    expect(res.value.yaml).toContain('"/orders/{id}":');
    expect(res.value.yaml).toContain('operationId: getOrdersById');
    expect(res.value.yaml).toContain("'201':");
    expect(res.value.yaml).toContain('format: date-time');
    expect(res.value.yaml).toContain('summary: "Get \\"order\\""');
  });
});

describe('session briefing', () => {
  it('summarises handoff, unfinished plans and red checks for the next session', async () => {
    const { services } = createTestHexaCore([1]);
    await services.orchestrator.orchestrate({ id: 'r', description: 'Orders feature', targetStack: 'node', sliceName: 'orders' });
    await services.stateRepo.addHandoff({ id: 'h', summary: 'Scaffolded orders', nextSteps: ['Fix validation'], openQuestions: [], createdAt: 'now' });

    const state = await services.stateRepo.loadState();
    if (!state.isSuccess) throw state.error;
    const briefing = buildBriefing(state.value, []);
    expect(briefing.briefing).toContain('Scaffolded orders');
    expect(briefing.briefing).toContain('Unfinished plan');
    expect(briefing.briefing).toContain('node/test (1 failing)');
    expect(briefing.pendingPlans[0].nextStep).toBe('Quality checks: test');
  });
});

describe('StackDetector', () => {
  it('finds stacks in monorepo sub-projects and ignores dependency folders', async () => {
    const root = path.resolve('/mono');
    const fs = new InMemoryFileSystem({
      [path.join(root, 'apps/api/go.mod')]: 'module x',
      [path.join(root, 'apps/web/package.json')]: JSON.stringify({ dependencies: { react: '19' } }),
      [path.join(root, 'services/billing/Billing.csproj')]: '<Project/>',
      [path.join(root, 'node_modules/foo/package.json')]: '{}',
      [path.join(root, 'a/b/c/deep/Cargo.toml')]: '',
    });
    const detected = await new StackDetector(fs).detect(root);
    expect(detected).toEqual([
      { stack: 'go', dir: 'apps/api' },
      { stack: 'react', dir: 'apps/web' },
      { stack: 'dotnet', dir: 'services/billing' },
    ]);
  });

  it('returns no stacks (not a fake "node") for an empty workspace', async () => {
    expect(await new StackDetector(new InMemoryFileSystem()).detectActiveStacks(path.resolve('/empty'))).toEqual([]);
  });
});
