import { SupportedStack } from '../../../shared/domain/stack.js';
import { SliceNames } from '../../../shared/domain/slice_names.js';

export type { SliceNames } from '../../../shared/domain/slice_names.js';

export type SliceLayer = 'domain' | 'application' | 'infrastructure' | 'presentation';

export interface ScaffoldOptions {
  stack: SupportedStack;
  sliceName: string;
  layer?: SliceLayer | 'full';
  /** Project directory (absolute, or relative to the workspace root). */
  targetDir?: string;
  /** Plan only: return the files that would be written, write nothing. */
  dryRun?: boolean;
  /** Replace files that already exist (the checkpoint still allows a rollback). */
  overwrite?: boolean;
  /** Generate the slice's tests too (default true for a full slice). */
  includeTests?: boolean;
}

/** Facts about the host project that generated code must agree with to compile. */
export interface ProjectProfile {
  /** .NET root namespace (from the main .csproj). */
  dotnetNamespace: string;
  /** Directory of the main .csproj, relative to the target dir ('' = the target dir itself). */
  dotnetProjectDir: string;
  /** Directory of an xUnit test project, if one exists. */
  dotnetTestProjectDir?: string;
  dotnetTestNamespace?: string;
  /** Elixir OTP app atom (my_app) and its module (MyApp). */
  elixirApp: string;
  elixirModule: string;
  /** Dart package name from pubspec.yaml. */
  dartPackage: string;
  jsTestRunner: 'vitest' | 'jest' | 'none';
  /** '.js' under NodeNext/Node16 resolution, '' for bundler/classic resolution. */
  jsImportExtension: '.js' | '';
}

export type GeneratedFileRole = SliceLayer | 'test' | 'module';

export interface GeneratedFile {
  /** Relative to the target directory, always with forward slashes. */
  path: string;
  content: string;
  role: GeneratedFileRole;
}

/** Ensures an existing host file references the slice (idempotent append; the file is created if missing). */
export interface Registration {
  path: string;
  /** Line that must be present; omitted = the file only has to exist (e.g. a Python __init__.py). */
  line?: string;
}

export interface SliceBlueprint {
  layers: Record<SliceLayer, GeneratedFile[]>;
  registrations?: Registration[];
  /** Composition root / module wiring (mod.rs, ServiceProvider, DI extension…). */
  module: GeneratedFile[];
  tests: GeneratedFile[];
  notes: string[];
}

export interface PlannedFile {
  path: string;
  role: GeneratedFileRole | 'registration';
  lines: number;
  exists: boolean;
  content?: string;
}

export interface ScaffoldResult {
  sliceName: string;
  stack: SupportedStack;
  dryRun: boolean;
  /** Absolute paths written (empty on a dry run). */
  createdFiles: string[];
  plannedFiles: PlannedFile[];
  checkpointId?: string;
  notes: string[];
  success: boolean;
  message: string;
}
