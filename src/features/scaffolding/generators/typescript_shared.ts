import { ProjectProfile, SliceNames } from '../domain/scaffold_types.js';

/** Pieces shared by the node and react/react-native generators. */
export function domainFile(n: SliceNames): string {
  return `export interface ${n.pascal}Entity {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface Create${n.pascal}Input {
  id: string;
}

/** Port: the application layer depends on this, infrastructure implements it. */
export interface ${n.pascal}Repository {
  save(entity: ${n.pascal}Entity): Promise<void>;
  findById(id: string): Promise<${n.pascal}Entity | undefined>;
}
`;
}

export function infrastructureFile(n: SliceNames, ext: string): string {
  return `import { ${n.pascal}Entity, ${n.pascal}Repository } from '../domain/${n.snake}_entity${ext}';

export class InMemory${n.pascal}Repository implements ${n.pascal}Repository {
  private readonly store = new Map<string, ${n.pascal}Entity>();

  async save(entity: ${n.pascal}Entity): Promise<void> {
    this.store.set(entity.id, entity);
  }

  async findById(id: string): Promise<${n.pascal}Entity | undefined> {
    return this.store.get(id);
  }
}
`;
}

export function testImports(p: ProjectProfile): string {
  return p.jsTestRunner === 'vitest' ? `import { describe, it, expect } from 'vitest';\n` : '';
}
