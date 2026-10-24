import { ProjectProfile, SliceBlueprint, SliceNames } from '../domain/scaffold_types.js';
import { domainFile, infrastructureFile, testImports } from './typescript_shared.js';

export function nodeBlueprint(n: SliceNames, p: ProjectProfile): SliceBlueprint {
  const ext = p.jsImportExtension;
  const base = `src/features/${n.snake}`;
  return {
    layers: {
      domain: [{ path: `${base}/domain/${n.snake}_entity.ts`, role: 'domain', content: domainFile(n) }],
      application: [
        {
          path: `${base}/application/${n.snake}_handler.ts`,
          role: 'application',
          content: `import { ${n.pascal}Entity, ${n.pascal}Repository, Create${n.pascal}Input } from '../domain/${n.snake}_entity${ext}';

export class ${n.pascal}Handler {
  constructor(private readonly repository: ${n.pascal}Repository) {}

  async create(input: Create${n.pascal}Input): Promise<${n.pascal}Entity> {
    if (!input.id) {
      throw new Error('${n.pascal}: "id" is required.');
    }
    const now = new Date().toISOString();
    const entity: ${n.pascal}Entity = { id: input.id, createdAt: now, updatedAt: now };
    await this.repository.save(entity);
    return entity;
  }

  async getById(id: string): Promise<${n.pascal}Entity | undefined> {
    return this.repository.findById(id);
  }
}
`,
        },
      ],
      infrastructure: [{ path: `${base}/infrastructure/${n.snake}_repository.ts`, role: 'infrastructure', content: infrastructureFile(n, ext) }],
      presentation: [
        {
          path: `${base}/presentation/${n.snake}_routes.ts`,
          role: 'presentation',
          content: `import { ${n.pascal}Handler } from '../application/${n.snake}_handler${ext}';

export function register${n.pascal}Routes(handler: ${n.pascal}Handler) {
  return {
    'POST /${n.kebab}': (body: { id: string }) => handler.create(body),
    'GET /${n.kebab}/:id': (id: string) => handler.getById(id),
  };
}
`,
        },
      ],
    },
    module: [
      {
        path: `${base}/index.ts`,
        role: 'module',
        content: `import { ${n.pascal}Handler } from './application/${n.snake}_handler${ext}';
import { InMemory${n.pascal}Repository } from './infrastructure/${n.snake}_repository${ext}';
import { register${n.pascal}Routes } from './presentation/${n.snake}_routes${ext}';

/** Composition root of the ${n.snake} slice: the only place that knows the concrete repository. */
export function create${n.pascal}Feature() {
  const handler = new ${n.pascal}Handler(new InMemory${n.pascal}Repository());
  return { handler, routes: register${n.pascal}Routes(handler) };
}

export type { ${n.pascal}Entity } from './domain/${n.snake}_entity${ext}';
`,
      },
    ],
    tests: [
      {
        path: `${base}/tests/${n.snake}_handler.test.ts`,
        role: 'test',
        content: `${testImports(p)}import { ${n.pascal}Handler } from '../application/${n.snake}_handler${ext}';
import { InMemory${n.pascal}Repository } from '../infrastructure/${n.snake}_repository${ext}';

describe('${n.pascal}Handler', () => {
  it('creates and retrieves a ${n.snake}', async () => {
    const handler = new ${n.pascal}Handler(new InMemory${n.pascal}Repository());
    const created = await handler.create({ id: '${n.kebab}-1' });
    expect(await handler.getById('${n.kebab}-1')).toEqual(created);
  });

  it('rejects a missing id', async () => {
    const handler = new ${n.pascal}Handler(new InMemory${n.pascal}Repository());
    await expect(handler.create({ id: '' })).rejects.toThrow('"id" is required');
  });
});
`,
      },
    ],
    notes: p.jsTestRunner === 'none' ? ['No vitest/jest found in package.json: the generated test assumes jest-style globals.'] : [],
  };
}
