import { IFileSystem } from '../../../shared/infrastructure/file_system.js';
import { SupportedStack } from '../../state_management/domain/state_types.js';

export class StackDetector {
  constructor(private readonly fileSystem: IFileSystem) {}

  async detectActiveStacks(baseDir: string = process.cwd()): Promise<SupportedStack[]> {
    const stacks: SupportedStack[] = [];

    if (await this.fileSystem.exists(`${baseDir}/mix.exs`)) stacks.push('elixir');
    if (await this.fileSystem.exists(`${baseDir}/Cargo.toml`)) stacks.push('rust');
    if (await this.fileSystem.exists(`${baseDir}/go.mod`)) stacks.push('go');
    if (await this.fileSystem.exists(`${baseDir}/pubspec.yaml`)) stacks.push('flutter');
    if (await this.fileSystem.exists(`${baseDir}/Gemfile`)) stacks.push('ruby');
    if (await this.fileSystem.exists(`${baseDir}/composer.json`)) stacks.push('laravel');
    if (await this.fileSystem.exists(`${baseDir}/pyproject.toml`) || await this.fileSystem.exists(`${baseDir}/requirements.txt`)) stacks.push('python');

    const files = await this.fileSystem.listDirectory(baseDir);
    if (files.some((f) => f.endsWith('.csproj') || f.endsWith('.sln'))) stacks.push('dotnet');

    if (await this.fileSystem.exists(`${baseDir}/package.json`)) {
      const pkg = await this.fileSystem.readFile(`${baseDir}/package.json`).catch(() => '');
      if (pkg.includes('react-native')) stacks.push('reactnative');
      else if (pkg.includes('react')) stacks.push('react');
      else stacks.push('node');
    }

    return stacks.length > 0 ? stacks : ['node'];
  }
}
