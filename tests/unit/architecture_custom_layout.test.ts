import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { ArchitectureChecker } from '../../src/features/architecture/services/architecture_checker.js';
import { classifyCustomPath, classifyNamespace, parseCustomLayout } from '../../src/features/architecture/domain/custom_layout.js';
import { WorkspaceContext } from '../../src/shared/infrastructure/workspace.js';
import { InMemoryFileSystem } from '../helpers/in_memory_fs.js';

const ROOT = path.resolve('/ws');

// A modular monolith: modules are slices, in two shapes, and only Contracts cross modules.
const architecture = {
  layout: ['src/Modules/{slice}/{slice}.{layer}/**', 'src/Modules/{slice}/{slice}/{layer}/**', 'src/Modules/{slice}/{slice}/*', 'web/src/app/features/{slice}/{layer}/**'],
  namespaces: ['{slice}.{layer}', '{slice}'],
  layers: {
    Contracts: { public: true, dependsOn: [] },
    Domain: { dependsOn: ['Contracts'] },
    Features: { dependsOn: ['Domain', 'Infrastructure', 'Persistence', 'Contracts'] },
    Infrastructure: { dependsOn: ['Domain', 'Contracts'] },
    Persistence: { dependsOn: ['Domain', 'Contracts'] },
    Migraciones: { dependsOn: ['*'] },
  },
  ignore: ['**/Migraciones/**'],
  maxFileLines: 20,
};

const cs = (ns: string, ...usings: string[]) => `${usings.map((u) => `using ${u};`).join('\n')}\nnamespace ${ns};\npublic class X {}`;

function audit(files: Record<string, string>, arch: unknown = architecture) {
  const fs = new InMemoryFileSystem({
    [path.join(ROOT, 'hexacore.json')]: JSON.stringify({ architecture: arch }),
    ...Object.fromEntries(Object.entries(files).map(([k, v]) => [path.join(ROOT, k), v])),
  });
  return new ArchitectureChecker(fs, new WorkspaceContext(ROOT)).check('.', { strict: true });
}

describe('custom layout patterns', () => {
  const { layout } = parseCustomLayout(architecture);

  it('finds slice and layer in both module shapes, and the slice root', () => {
    expect(classifyCustomPath(layout!, 'src/Modules/Catastro/Catastro.Domain/Predios.cs')).toEqual({ slice: 'catastro', role: 'unknown', layer: 'domain' });
    expect(classifyCustomPath(layout!, 'src/Modules/Ingesta/Ingesta/Features/Cargas/Subir.cs')).toEqual({ slice: 'ingesta', role: 'unknown', layer: 'features' });
    expect(classifyCustomPath(layout!, 'src/Modules/Ingesta/Ingesta/IngestaModulo.cs')).toEqual({ slice: 'ingesta', role: 'module' });
    // {slice} repeated must be the same name.
    expect(classifyCustomPath(layout!, 'src/Modules/Catastro/Ingesta.Domain/X.cs')).toBeUndefined();
    expect(classifyCustomPath(layout!, 'web/src/app/features/catastro/paginas/mapa.spec.ts')?.role).toBe('test');
  });

  it('resolves C# namespaces, sub-namespaces included', () => {
    expect(classifyNamespace(layout!, 'Conciliacion.Domain.Comparacion')).toEqual({ slice: 'conciliacion', role: 'unknown', layer: 'domain' });
    expect(classifyNamespace(layout!, 'Ingesta')).toEqual({ slice: 'ingesta', role: 'module' });
  });

  it('reports config mistakes instead of passing silently', () => {
    expect(parseCustomLayout({ layout: ['src/**'], layers: { Domain: { dependsOn: 'Contracts' } }, maxFileLines: -1 }).errors).toEqual([
      "layout pattern 'src/**' has no {slice}",
      'layers.Domain.dependsOn must be a list of layer names',
      'architecture.maxFileLines must be a positive whole number',
    ]);
    expect(parseCustomLayout({ compositionSlices: ['x'] })).toEqual({ errors: [] });
  });
});

describe('ArchitectureChecker with a project layout', () => {
  it('passes a clean modular monolith: Contracts across modules, Features using Infrastructure', async () => {
    const report = await audit({
      'src/Modules/Catastro/Catastro.Contracts/IPredios.cs': cs('Catastro.Contracts'),
      'src/Modules/Catastro/Catastro.Domain/Predio.cs': cs('Catastro.Domain', 'Catastro.Contracts', 'System.Linq'),
      'src/Modules/Catastro/Catastro.Infrastructure/Db.cs': cs('Catastro.Infrastructure', 'Catastro.Domain'),
      'src/Modules/Catastro/Catastro.Features/Predios/Crear.cs': cs('Catastro.Features.Predios', 'Catastro.Infrastructure', 'Catastro.Domain'),
      'src/Modules/Conciliacion/Conciliacion.Features/Comparar.cs': cs('Conciliacion.Features', 'Catastro.Contracts'),
      'src/Modules/Catastro/Catastro.Infrastructure/Migraciones/Inicial.cs': 'x\n'.repeat(500),
    });
    expect(report.isSuccess).toBe(true);
    if (!report.isSuccess) return;
    expect(report.value).toMatchObject({ layout: 'custom', passed: true, violations: [] });
    expect(report.value.slices).toEqual(['catastro', 'conciliacion']);
  });

  it('flags another module internals, layers going the wrong way, and its own line limit', async () => {
    const report = await audit({
      'src/Modules/Catastro/Catastro.Domain/Predio.cs': cs('Catastro.Domain', 'Catastro.Infrastructure'),
      'src/Modules/Catastro/Catastro.Infrastructure/Db.cs': cs('Catastro.Infrastructure'),
      'src/Modules/Catastro/Catastro.Contracts/IPredios.cs': cs('Catastro.Contracts', 'Catastro.Domain'),
      'src/Modules/Conciliacion/Conciliacion.Features/Comparar.cs': cs('Conciliacion.Features', 'Catastro.Domain'),
      'src/Modules/Conciliacion/Conciliacion.Features/Largo.cs': 'x\n'.repeat(30),
      'src/Modules/Conciliacion/Conciliacion.Features/LargoTests.cs': 'x\n'.repeat(30),
    });
    if (!report.isSuccess) throw report.error;
    const found = report.value.violations.map((v) => `${v.rule} ${v.file}${v.line ? `:${v.line}` : ''}`);
    expect(found.sort()).toEqual([
      'CROSS_SLICE_COUPLING src/Modules/Conciliacion/Conciliacion.Features/Comparar.cs:1',
      'LAYER_DEPENDENCY_VIOLATION src/Modules/Catastro/Catastro.Contracts/IPredios.cs:1',
      'LAYER_DEPENDENCY_VIOLATION src/Modules/Catastro/Catastro.Domain/Predio.cs:1',
      'MAX_LINE_COUNT_EXCEEDED src/Modules/Conciliacion/Conciliacion.Features/Largo.cs',
    ]);
    const cross = report.value.violations.find((v) => v.rule === 'CROSS_SLICE_COUPLING')!;
    expect(cross.message).toBe("Slice 'conciliacion' uses the Domain layer of slice 'catastro' (Catastro.Domain). Other slices may only use: Contracts.");
    const contracts = report.value.violations.find((v) => v.file.endsWith('IPredios.cs'))!;
    expect(contracts.message).toMatch(/Contracts may only depend on: nothing else/);
  });

  it('resolves relative TypeScript imports through the layout', async () => {
    const report = await audit({
      'web/src/app/features/catastro/Domain/predio.ts': "import { Api } from '../Infrastructure/api';",
      'web/src/app/features/catastro/Infrastructure/api.ts': 'export class Api {}',
    });
    if (!report.isSuccess) throw report.error;
    expect(report.value.violations.map((v) => v.rule)).toEqual(['LAYER_DEPENDENCY_VIOLATION']);
  });

  it('falls back to the default rules when the layout is invalid, and says why', async () => {
    const report = await audit({ 'src/features/orders/domain/o.ts': "import { Db } from '../infrastructure/db.js';", 'src/features/orders/infrastructure/db.ts': '' }, { layout: 'src' });
    if (!report.isSuccess) throw report.error;
    expect(report.value.layout).toBe('default');
    expect(report.value.configErrors).toEqual(['architecture.layout must be a non-empty list of path patterns']);
    expect(report.value.violations.map((v) => v.rule)).toEqual(['LAYER_DEPENDENCY_VIOLATION']);
  });
});
