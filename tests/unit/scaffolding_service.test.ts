import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { ScaffoldingService } from '../../src/features/scaffolding/services/scaffolding_service.js';
import { ChangeJournal } from '../../src/shared/infrastructure/change_journal.js';
import { WorkspaceContext } from '../../src/shared/infrastructure/workspace.js';
import { InMemoryFileSystem } from '../helpers/in_memory_fs.js';

const ROOT = path.resolve('/workspace');

function setup(seed: Record<string, string> = {}) {
  const fs = new InMemoryFileSystem(Object.fromEntries(Object.entries(seed).map(([k, v]) => [path.join(ROOT, k), v])));
  const workspace = new WorkspaceContext(ROOT);
  const journal = new ChangeJournal(fs, workspace);
  return { fs, journal, service: new ScaffoldingService(fs, workspace, journal) };
}

const sourceFiles = (fs: InMemoryFileSystem) => [...fs.files.keys()].filter((f) => !f.includes('.hexagen'));

describe('ScaffoldingService', () => {
  it('scaffolds a node slice with DIP wiring, a composition module and tests', async () => {
    const { fs, service } = setup({ 'package.json': JSON.stringify({ devDependencies: { vitest: '^4' } }) });
    const res = await service.executeScaffolding({ stack: 'node', sliceName: 'orders' });

    expect(res.isSuccess).toBe(true);
    if (!res.isSuccess) return;
    const rel = res.value.createdFiles.map((f) => path.relative(ROOT, f).split(path.sep).join('/'));
    expect(rel).toEqual([
      'src/features/orders/domain/orders_entity.ts',
      'src/features/orders/application/orders_handler.ts',
      'src/features/orders/infrastructure/orders_repository.ts',
      'src/features/orders/presentation/orders_routes.ts',
      'src/features/orders/index.ts',
      'src/features/orders/tests/orders_handler.test.ts',
    ]);
    const handler = await fs.readFile(path.join(ROOT, 'src/features/orders/application/orders_handler.ts'));
    expect(handler).not.toContain('infrastructure');
    expect(res.value.checkpointId).toMatch(/^cp_/);
  });

  it('normalizes kebab-case names into valid identifiers', async () => {
    const { fs, service } = setup();
    const res = await service.executeScaffolding({ stack: 'go', sliceName: 'user-profile' });
    expect(res.isSuccess).toBe(true);
    const domain = await fs.readFile(path.join(ROOT, 'internal/slices/userprofile/domain.go'));
    expect(domain).toContain('package userprofile');
    expect(domain).toContain('type UserProfileEntity struct');
  });

  it('dry run plans files and their content without writing anything', async () => {
    const { fs, service } = setup();
    const res = await service.executeScaffolding({ stack: 'python', sliceName: 'payment', dryRun: true });
    expect(res.isSuccess).toBe(true);
    if (!res.isSuccess) return;
    expect(res.value.dryRun).toBe(true);
    expect(res.value.plannedFiles.length).toBeGreaterThan(4);
    expect(res.value.plannedFiles[0].content).toContain('class PaymentEntity');
    expect(sourceFiles(fs)).toHaveLength(0);
  });

  it('refuses to overwrite existing files and writes nothing at all', async () => {
    const { fs, service } = setup({ 'app/slices/payment/domain.py': '# my hand-written code' });
    const res = await service.executeScaffolding({ stack: 'python', sliceName: 'payment' });
    expect(res.isFailure).toBe(true);
    if (res.isFailure) expect(res.error.message).toContain('Refusing to overwrite');
    expect(sourceFiles(fs)).toHaveLength(1);
    expect(await fs.readFile(path.join(ROOT, 'app/slices/payment/domain.py'))).toBe('# my hand-written code');
  });

  it('overwrite is reversible through the checkpoint', async () => {
    const { fs, service, journal } = setup({ 'app/slices/payment/domain.py': '# original' });
    const res = await service.executeScaffolding({ stack: 'python', sliceName: 'payment', overwrite: true });
    expect(res.isSuccess).toBe(true);
    if (!res.isSuccess) return;

    const rollback = await journal.rollback(res.value.checkpointId!);
    expect(rollback.isSuccess && rollback.value.applied).toBe(true);
    expect(await fs.readFile(path.join(ROOT, 'app/slices/payment/domain.py'))).toBe('# original');
    expect(sourceFiles(fs)).toHaveLength(1);
  });

  it('generates only the requested layer', async () => {
    const { service } = setup();
    const res = await service.executeScaffolding({ stack: 'python', sliceName: 'payment', layer: 'domain' });
    expect(res.isSuccess && res.value.createdFiles).toHaveLength(1);
  });

  it('adapts .NET namespaces and paths to the host project and its xUnit test project', async () => {
    const { fs, service } = setup({
      'src/Shop.Api/Shop.Api.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>',
      'tests/Shop.Tests/Shop.Tests.csproj': '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="xunit" /></ItemGroup></Project>',
    });
    const res = await service.executeScaffolding({ stack: 'dotnet', sliceName: 'billing' });
    expect(res.isSuccess).toBe(true);
    const entity = await fs.readFile(path.join(ROOT, 'src/Shop.Api/Features/Billing/Domain/BillingEntity.cs'));
    expect(entity).toContain('namespace Shop.Api.Features.Billing.Domain;');
    expect(await fs.exists(path.join(ROOT, 'tests/Shop.Tests/Features/Billing/CreateBillingHandlerTests.cs'))).toBe(true);
  });

  it('rejects names that would escape the workspace or break identifiers', async () => {
    const { service } = setup();
    for (const bad of ['../evil', 'a b', '1orders', 'type']) {
      const res = await service.executeScaffolding({ stack: 'node', sliceName: bad });
      expect(res.isFailure).toBe(true);
    }
    const outside = await service.executeScaffolding({ stack: 'node', sliceName: 'ok', targetDir: '../elsewhere' });
    expect(outside.isFailure).toBe(true);
  });
});
