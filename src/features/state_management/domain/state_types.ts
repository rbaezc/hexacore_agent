export type SupportedStack =
  | 'elixir'
  | 'dotnet'
  | 'node'
  | 'laravel'
  | 'rust'
  | 'python'
  | 'react'
  | 'go'
  | 'flutter'
  | 'ruby'
  | 'reactnative';

export interface ProjectMetadata {
  projectName: string;
  activeStacks: SupportedStack[];
  version: string;
  lastUpdated: string;
}

export interface CaseFact {
  key: string;
  value: string;
  category: 'database' | 'filepath' | 'config' | 'transaction';
  updatedAt: string;
}

export type LedgerStepStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface LedgerStep {
  id: string;
  title: string;
  description: string;
  status: LedgerStepStatus;
  sliceName?: string;
  assignedAgent?: string;
  error?: string;
  timestamp: string;
}

export interface StateManifest {
  metadata: ProjectMetadata;
  facts: CaseFact[];
  ledger: LedgerStep[];
}
