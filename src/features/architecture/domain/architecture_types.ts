export type ArchitectureRole = 'domain' | 'application' | 'infrastructure' | 'presentation' | 'module' | 'test' | 'unknown';

export type SourceLanguage = 'typescript' | 'dart' | 'python' | 'rust' | 'go' | 'csharp' | 'php' | 'ruby' | 'elixir';

/** Where a file sits in the VSA layout. `slice` is normalized (lowercase, no separators) so spellings compare equal. */
export interface SourceLocation {
  slice: string;
  role: ArchitectureRole;
}

export interface ImportReference {
  line: number;
  /** The import as written, for the report. */
  specifier: string;
  target: SourceLocation;
}

export type ArchitectureRule = 'MAX_LINE_COUNT_EXCEEDED' | 'CROSS_SLICE_COUPLING' | 'LAYER_DEPENDENCY_VIOLATION';

export interface ArchitectureViolation {
  rule: ArchitectureRule;
  severity: 'error' | 'warning';
  file: string;
  line?: number;
  message: string;
}

export interface ArchitectureReport {
  root: string;
  filesScanned: number;
  slices: string[];
  passed: boolean;
  errorCount: number;
  warningCount: number;
  violations: ArchitectureViolation[];
  truncated: boolean;
}

/** Which roles each role may depend on inside its own slice. module/test/unknown are unrestricted. */
export const ALLOWED_DEPENDENCIES: Partial<Record<ArchitectureRole, ArchitectureRole[]>> = {
  domain: ['domain'],
  application: ['domain', 'application'],
  infrastructure: ['domain', 'application', 'infrastructure'],
  presentation: ['domain', 'application', 'presentation', 'module'],
};
