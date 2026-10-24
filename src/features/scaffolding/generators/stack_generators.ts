import { GeneratedFile, ProjectProfile, ScaffoldOptions, SliceBlueprint, SliceNames } from '../domain/scaffold_types.js';
import { nodeBlueprint } from './node_generator.js';
import { reactBlueprint } from './react_generator.js';
import { dotnetBlueprint } from './dotnet_generator.js';
import { laravelBlueprint } from './laravel_generator.js';
import { rubyBlueprint } from './ruby_generator.js';
import { rustBlueprint } from './rust_generator.js';
import { goBlueprint } from './go_generator.js';
import { pythonBlueprint } from './python_generator.js';
import { flutterBlueprint } from './flutter_generator.js';
import { elixirBlueprint } from './elixir_generator.js';

export const DEFAULT_PROFILE: ProjectProfile = {
  dotnetNamespace: 'App',
  dotnetProjectDir: '',
  elixirApp: 'app',
  elixirModule: 'App',
  dartPackage: 'app',
  jsTestRunner: 'vitest',
  jsImportExtension: '.js',
};

export function blueprintFor(stack: ScaffoldOptions['stack'], names: SliceNames, profile: ProjectProfile): SliceBlueprint {
  switch (stack) {
    case 'node':
      return nodeBlueprint(names, profile);
    case 'react':
      return reactBlueprint(names, profile, false);
    case 'reactnative':
      return reactBlueprint(names, profile, true);
    case 'dotnet':
      return dotnetBlueprint(names, profile);
    case 'laravel':
      return laravelBlueprint(names);
    case 'ruby':
      return rubyBlueprint(names);
    case 'rust':
      return rustBlueprint(names);
    case 'go':
      return goBlueprint(names);
    case 'python':
      return pythonBlueprint(names);
    case 'flutter':
      return flutterBlueprint(names, profile);
    case 'elixir':
      return elixirBlueprint(names, profile);
  }
}

/** Flattens a blueprint into the files to write for the requested layer. */
export function selectFiles(blueprint: SliceBlueprint, layer: ScaffoldOptions['layer'] = 'full', includeTests: boolean = true): GeneratedFile[] {
  if (layer !== 'full') return blueprint.layers[layer];
  const { domain, application, infrastructure, presentation } = blueprint.layers;
  return [...domain, ...application, ...infrastructure, ...presentation, ...blueprint.module, ...(includeTests ? blueprint.tests : [])];
}
