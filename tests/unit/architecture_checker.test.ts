import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { ArchitectureChecker } from '../../src/features/architecture/services/architecture_checker.js';
import { ScaffoldingService } from '../../src/features/scaffolding/services/scaffolding_service.js';
import { WorkspaceContext } from '../../src/shared/infrastructure/workspace.js';
import { SUPPORTED_STACKS } from '../../src/features/state_management/domain/state_types.js';
import { InMemoryFileSystem } from '../helpers/in_memory_fs.js';

const ROOT = path.resolve('/ws');

function checker(files: Record<string, string>) {
  const fs = new InMemoryFileSystem(Object.fromEntries(Object.entries(files).map(([k, v]) => [path.join(ROOT, k), v])));
  return { fs, checker: new ArchitectureChecker(fs, new WorkspaceContext(ROOT)) };
}

describe('ArchitectureChecker', () => {
  it('passes a clean TypeScript slice', async () => {
    const { checker: c } = checker({
      'src/features/orders/domain/orders_entity.ts': 'export interface Orders {}',
      'src/features/orders/application/orders_handler.ts': "import { Orders } from '../domain/orders_entity.js';",
      'src/features/orders/index.ts': "import { X } from './infrastructure/repo.js';",
    });
    const report = await c.check();
    expect(report.isSuccess && report.value.passed).toBe(true);
  });

  it('flags domain → infrastructure and cross-slice internals as errors', async () => {
    const { checker: c } = checker({
      'src/features/orders/domain/orders_entity.ts': "import { Db } from '../infrastructure/db.js';",
      'src/features/orders/infrastructure/db.ts': 'export class Db {}',
      'src/features/billing/application/pay.ts': "import { Db } from '../../orders/infrastructure/db.js';",
      'src/features/billing/presentation/view.ts': "import { create } from '../../orders/index.js';",
    });
    const report = await c.check();
    expect(report.isSuccess).toBe(true);
    if (!report.isSuccess) return;
    const rules = report.value.violations.map((v) => `${v.rule}:${v.severity}:${v.file}`);
    expect(rules).toContain('LAYER_DEPENDENCY_VIOLATION:error:src/features/orders/domain/orders_entity.ts');
    expect(rules).toContain('CROSS_SLICE_COUPLING:error:src/features/billing/application/pay.ts');
    expect(rules).toContain('CROSS_SLICE_COUPLING:warning:src/features/billing/presentation/view.ts');
    expect(report.value.passed).toBe(false);
  });

  it('understands namespace-based languages (C#, PHP) and Rust/Python module paths', async () => {
    const { checker: c } = checker({
      'Api/Features/Orders/Domain/Order.cs': 'using App.Features.Orders.Infrastructure;\nnamespace App.Features.Orders.Domain;',
      'Api/Features/Orders/Infrastructure/Repo.cs': 'namespace App.Features.Orders.Infrastructure;',
      'app/Features/Billing/Application/Pay.php': '<?php use App\\Features\\Orders\\Infrastructure\\Repo;',
      'app/Features/Orders/Infrastructure/Repo.php': '<?php',
      'src/slices/orders/domain.rs': 'use super::repository::Repo;',
      'src/slices/orders/repository.rs': 'pub struct Repo;',
      'app/slices/orders/domain.py': 'from .service import x',
      'app/slices/orders/service.py': 'x = 1',
    });
    const report = await c.check();
    expect(report.isSuccess).toBe(true);
    if (!report.isSuccess) return;
    const files = report.value.violations.map((v) => v.file);
    expect(files).toContain('Api/Features/Orders/Domain/Order.cs');
    expect(files).toContain('app/Features/Billing/Application/Pay.php');
    expect(files).toContain('src/slices/orders/domain.rs');
    expect(files).toContain('app/slices/orders/domain.py');
  });

  it('lets composition slices declared in hexacore.json use public modules, never internals', async () => {
    const files = {
      'src/features/orders/index.ts': 'export {};',
      'src/features/orders/infrastructure/db.ts': 'export class Db {}',
      'src/features/orchestrator/services/run.ts': "import { create } from '../../orders/index.js';\nimport { Db } from '../../orders/infrastructure/db.js';",
      'src/features/billing/services/pay.ts': "import { create } from '../../orders/index.js';",
    };
    const describeViolations = async (extra: Record<string, string>) => {
      const report = await checker({ ...files, ...extra }).checker.check();
      if (!report.isSuccess) throw report.error;
      return { ...report.value, found: report.value.violations.map((v) => `${v.severity}:${v.file}:${v.line}`) };
    };

    const strict = await describeViolations({});
    expect(strict.found).toEqual(
      expect.arrayContaining(['warning:src/features/orchestrator/services/run.ts:1', 'error:src/features/orchestrator/services/run.ts:2', 'warning:src/features/billing/services/pay.ts:1'])
    );

    const configured = await describeViolations({ 'hexacore.json': JSON.stringify({ architecture: { compositionSlices: ['orchestrator'] } }) });
    expect(configured.compositionSlices).toEqual(['orchestrator']);
    expect(configured.found.sort()).toEqual(['error:src/features/orchestrator/services/run.ts:2', 'warning:src/features/billing/services/pay.ts:1']);

    // A broken config falls back to the strict rules instead of hiding violations.
    expect((await describeViolations({ 'hexacore.json': '{ nope' })).found).toHaveLength(3);
  });

  it('flags oversized files but ignores node_modules', async () => {
    const big = Array(260).fill('x();').join('\n');
    const { checker: c } = checker({ 'src/features/a/domain/big.ts': big, 'node_modules/lib/huge.js': big });
    const report = await c.check();
    expect(report.isSuccess && report.value.violations.map((v) => v.file)).toEqual(['src/features/a/domain/big.ts']);
  });

  it('every generated slice, for every stack, passes the architecture check', async () => {
    for (const stack of SUPPORTED_STACKS) {
      const fs = new InMemoryFileSystem({
        [path.join(ROOT, 'mix.exs')]: 'defmodule Shop.MixProject do\n  def project, do: [app: :shop]\nend',
        [path.join(ROOT, 'pubspec.yaml')]: 'name: shop_app\n',
      });
      const ws = new WorkspaceContext(ROOT);
      const scaffold = await new ScaffoldingService(fs, ws).executeScaffolding({ stack, sliceName: 'orders' });
      expect(scaffold.isSuccess, stack).toBe(true);
      await new ScaffoldingService(fs, ws).executeScaffolding({ stack, sliceName: 'invoices' });

      const report = await new ArchitectureChecker(fs, ws).check();
      expect(report.isSuccess, stack).toBe(true);
      if (report.isSuccess) expect(report.value.violations, `${stack}: ${JSON.stringify(report.value.violations)}`).toEqual([]);
    }
  });
});
