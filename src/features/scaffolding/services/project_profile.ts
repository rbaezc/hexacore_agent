import * as path from 'node:path';
import { IFileSystem, DEFAULT_IGNORED_DIRS } from '../../../shared/infrastructure/file_system.js';
import { SupportedStack } from '../../../shared/domain/stack.js';
import { ProjectProfile } from '../domain/scaffold_types.js';
import { DEFAULT_PROFILE } from '../generators/stack_generators.js';

const TEST_PROJECT_MARKER = /xunit|Microsoft\.NET\.Test\.Sdk|nunit|MSTest/i;

/** Reads the host project's manifests so generated code uses its real names, not `App`. */
export class ProjectProfileDetector {
  constructor(private readonly fileSystem: IFileSystem) {}

  async detect(stack: SupportedStack, targetDir: string): Promise<ProjectProfile> {
    const profile: ProjectProfile = { ...DEFAULT_PROFILE };
    switch (stack) {
      case 'dotnet':
        await this.dotnet(targetDir, profile);
        break;
      case 'elixir': {
        const mix = await this.read(targetDir, 'mix.exs');
        const app = mix.match(/app:\s*:(\w+)/)?.[1];
        if (app) {
          profile.elixirApp = app;
          profile.elixirModule = app.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
        }
        // `defmodule MyApp.MixProject` is the authoritative module name when it differs from the atom.
        const declared = mix.match(/defmodule\s+([\w.]+)\.MixProject/)?.[1];
        if (declared) profile.elixirModule = declared;
        break;
      }
      case 'flutter': {
        const name = (await this.read(targetDir, 'pubspec.yaml')).match(/^name:\s*([\w]+)/m)?.[1];
        if (name) profile.dartPackage = name;
        break;
      }
      case 'node':
      case 'react':
      case 'reactnative':
        await this.javascript(targetDir, profile);
        break;
    }
    return profile;
  }

  private async javascript(targetDir: string, profile: ProjectProfile): Promise<void> {
    try {
      const pkg = JSON.parse(await this.read(targetDir, 'package.json'));
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      profile.jsTestRunner = deps.vitest ? 'vitest' : deps.jest || deps['jest-expo'] ? 'jest' : 'none';
    } catch {
      profile.jsTestRunner = 'vitest';
    }
    // tsconfig may contain comments; a regex is more forgiving than JSON.parse here.
    const tsconfig = await this.read(targetDir, 'tsconfig.json');
    const resolution = tsconfig.match(/"moduleResolution"\s*:\s*"(\w+)"/i)?.[1]?.toLowerCase();
    const module = tsconfig.match(/"module"\s*:\s*"(\w+)"/i)?.[1]?.toLowerCase();
    const strictEsm = resolution === 'nodenext' || resolution === 'node16' || (!resolution && (module === 'nodenext' || module === 'node16'));
    profile.jsImportExtension = tsconfig ? (strictEsm ? '.js' : '') : '.js';
  }

  private async dotnet(targetDir: string, profile: ProjectProfile): Promise<void> {
    const projects = (await this.fileSystem.listDirectory(targetDir, DEFAULT_IGNORED_DIRS))
      .filter((f) => f.endsWith('.csproj'))
      .filter((f) => path.relative(targetDir, f).split(path.sep).length <= 4);

    const described = await Promise.all(projects.map(async (file) => ({ file, content: await this.fileSystem.readFile(file) })));
    const tests = described.filter((p) => TEST_PROJECT_MARKER.test(p.content));
    const mains = described.filter((p) => !TEST_PROJECT_MARKER.test(p.content));
    // Prefer the web project: it's where controllers (the presentation layer) can compile.
    const main = mains.find((p) => /Sdk\.Web/.test(p.content)) ?? mains[0];
    const testProject = tests.find((p) => /xunit/i.test(p.content));

    if (main) {
      profile.dotnetNamespace = this.rootNamespace(main.file, main.content);
      profile.dotnetProjectDir = this.relativeDir(targetDir, main.file);
    }
    if (testProject) {
      profile.dotnetTestProjectDir = this.relativeDir(targetDir, testProject.file);
      profile.dotnetTestNamespace = this.rootNamespace(testProject.file, testProject.content);
    }
  }

  private rootNamespace(file: string, content: string): string {
    const declared = content.match(/<RootNamespace>([^<]+)<\/RootNamespace>/)?.[1];
    return (declared ?? path.basename(file, '.csproj')).replace(/[^\w.]/g, '_');
  }

  private relativeDir(targetDir: string, file: string): string {
    return path.relative(targetDir, path.dirname(file)).split(path.sep).join('/');
  }

  private async read(dir: string, file: string): Promise<string> {
    const full = path.join(dir, file);
    return (await this.fileSystem.exists(full)) ? this.fileSystem.readFile(full) : '';
  }
}
