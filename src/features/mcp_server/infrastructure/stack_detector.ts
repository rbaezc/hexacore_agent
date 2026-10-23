import * as path from 'node:path';
import { IFileSystem, DEFAULT_IGNORED_DIRS } from '../../../shared/infrastructure/file_system.js';
import { SupportedStack } from '../../../shared/domain/stack.js';

export interface DetectedStack {
  stack: SupportedStack;
  /** Directory relative to the scanned root ('.' for the root itself). */
  dir: string;
}

const MAX_DEPTH = 2;

/** Finds every stack in a workspace, including monorepo sub-projects up to two levels deep. */
export class StackDetector {
  constructor(private readonly fileSystem: IFileSystem) {}

  async detect(baseDir: string = process.cwd()): Promise<DetectedStack[]> {
    const files = await this.fileSystem.listDirectory(baseDir, DEFAULT_IGNORED_DIRS, MAX_DEPTH);
    const byDir = new Map<string, Set<string>>();
    for (const file of files) {
      const rel = path.relative(baseDir, file).split(path.sep);
      const dir = rel.slice(0, -1).join('/') || '.';
      const names = byDir.get(dir) ?? new Set<string>();
      names.add(rel[rel.length - 1]);
      byDir.set(dir, names);
    }

    const detected: DetectedStack[] = [];
    for (const [dir, names] of [...byDir.entries()].sort(([a], [b]) => a.length - b.length || a.localeCompare(b))) {
      for (const stack of await this.stacksIn(baseDir, dir, names)) detected.push({ stack, dir });
    }
    return detected;
  }

  /** Unique stacks in the workspace; empty when nothing is recognised (callers then offer every stack). */
  async detectActiveStacks(baseDir: string = process.cwd()): Promise<SupportedStack[]> {
    return [...new Set((await this.detect(baseDir)).map((d) => d.stack))];
  }

  private async stacksIn(baseDir: string, dir: string, names: Set<string>): Promise<SupportedStack[]> {
    const stacks: SupportedStack[] = [];
    if (names.has('mix.exs')) stacks.push('elixir');
    if (names.has('Cargo.toml')) stacks.push('rust');
    if (names.has('go.mod')) stacks.push('go');
    if (names.has('pubspec.yaml')) stacks.push('flutter');
    if (names.has('Gemfile')) stacks.push('ruby');
    if (names.has('composer.json')) stacks.push('laravel');
    if (names.has('pyproject.toml') || names.has('requirements.txt') || names.has('setup.py')) stacks.push('python');
    if ([...names].some((f) => f.endsWith('.csproj') || f.endsWith('.sln'))) stacks.push('dotnet');

    if (names.has('package.json')) {
      try {
        const pkg = JSON.parse(await this.fileSystem.readFile(path.join(baseDir, dir, 'package.json')));
        const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
        if (deps['react-native'] || deps.expo) stacks.push('reactnative');
        else if (deps.react) stacks.push('react');
        else stacks.push('node');
      } catch {
        stacks.push('node');
      }
    }
    return stacks;
  }
}
