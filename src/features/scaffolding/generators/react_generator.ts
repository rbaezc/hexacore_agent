import { ProjectProfile, SliceBlueprint, SliceNames } from '../domain/scaffold_types.js';
import { domainFile, infrastructureFile, testImports } from './typescript_shared.js';

export function reactBlueprint(n: SliceNames, p: ProjectProfile, native: boolean): SliceBlueprint {
  const ext = p.jsImportExtension;
  const base = `src/features/${n.snake}`;
  const component = native ? `${n.pascal}Screen` : `${n.pascal}View`;
  const markup = native
    ? `    <View>
      <Pressable onPress={() => void create(String(Date.now()))}>
        <Text>Create ${n.pascal}</Text>
      </Pressable>
      {entity && <Text>{entity.id}</Text>}
    </View>`
    : `    <div>
      <button onClick={() => void create(String(Date.now()))}>Create ${n.pascal}</button>
      {entity && <p>{entity.id}</p>}
    </div>`;

  return {
    layers: {
      domain: [{ path: `${base}/domain/${n.snake}_entity.ts`, role: 'domain', content: domainFile(n) }],
      application: [
        {
          path: `${base}/application/${n.snake}_service.ts`,
          role: 'application',
          content: `import { ${n.pascal}Entity, ${n.pascal}Repository } from '../domain/${n.snake}_entity${ext}';

/** Framework-free use case: unit-testable without rendering anything. */
export async function create${n.pascal}(repository: ${n.pascal}Repository, id: string): Promise<${n.pascal}Entity> {
  if (!id) {
    throw new Error('${n.pascal}: "id" is required.');
  }
  const now = new Date().toISOString();
  const entity: ${n.pascal}Entity = { id, createdAt: now, updatedAt: now };
  await repository.save(entity);
  return entity;
}
`,
        },
        {
          path: `${base}/application/use_${n.snake}.ts`,
          role: 'application',
          content: `import { useCallback, useState } from 'react';
import { ${n.pascal}Entity, ${n.pascal}Repository } from '../domain/${n.snake}_entity${ext}';
import { create${n.pascal} } from './${n.snake}_service${ext}';

export function use${n.pascal}(repository: ${n.pascal}Repository) {
  const [entity, setEntity] = useState<${n.pascal}Entity | undefined>(undefined);

  const create = useCallback(
    async (id: string) => {
      const created = await create${n.pascal}(repository, id);
      setEntity(created);
      return created;
    },
    [repository]
  );

  return { entity, create };
}
`,
        },
      ],
      infrastructure: [{ path: `${base}/infrastructure/${n.snake}_repository.ts`, role: 'infrastructure', content: infrastructureFile(n, ext) }],
      presentation: [
        {
          path: `${base}/presentation/${component}.tsx`,
          role: 'presentation',
          content: `${native ? `import { Pressable, Text, View } from 'react-native';\n` : ''}import { ${n.pascal}Repository } from '../domain/${n.snake}_entity${ext}';
import { use${n.pascal} } from '../application/use_${n.snake}${ext}';

export function ${component}({ repository }: { repository: ${n.pascal}Repository }) {
  const { entity, create } = use${n.pascal}(repository);

  return (
${markup}
  );
}
`,
        },
      ],
    },
    module: [
      {
        path: `${base}/index.tsx`,
        role: 'module',
        content: `import { InMemory${n.pascal}Repository } from './infrastructure/${n.snake}_repository${ext}';
import { ${component} } from './presentation/${component}${ext}';

const repository = new InMemory${n.pascal}Repository();

/** Composition root of the ${n.snake} slice. */
export function ${n.pascal}Feature() {
  return <${component} repository={repository} />;
}
`,
      },
    ],
    tests: [
      {
        path: `${base}/tests/${n.snake}_service.test.ts`,
        role: 'test',
        content: `${testImports(p)}import { create${n.pascal} } from '../application/${n.snake}_service${ext}';
import { InMemory${n.pascal}Repository } from '../infrastructure/${n.snake}_repository${ext}';

describe('create${n.pascal}', () => {
  it('creates and stores a ${n.snake}', async () => {
    const repository = new InMemory${n.pascal}Repository();
    const created = await create${n.pascal}(repository, '${n.kebab}-1');
    expect(await repository.findById('${n.kebab}-1')).toEqual(created);
  });

  it('rejects a missing id', async () => {
    await expect(create${n.pascal}(new InMemory${n.pascal}Repository(), '')).rejects.toThrow('"id" is required');
  });
});
`,
      },
    ],
    notes: [],
  };
}
