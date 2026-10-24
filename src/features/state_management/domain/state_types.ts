import { SupportedStack } from '../../../shared/domain/stack.js';

export type { SupportedStack } from '../../../shared/domain/stack.js';
export { SUPPORTED_STACKS } from '../../../shared/domain/stack.js';

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

export type PlanStepKind = 'rag' | 'scaffold' | 'qa' | 'architecture';

export interface PlanStep {
  id: string;
  kind: PlanStepKind;
  title: string;
  sliceName?: string;
  status: LedgerStepStatus;
  output?: string;
  checkpointId?: string;
  updatedAt: string;
}

export interface PlannedSlice {
  name: string;
  description?: string;
  layer?: 'domain' | 'application' | 'infrastructure' | 'presentation' | 'full';
}

/** A requirement decomposed into steps; persisted so work survives a crash or a new session. */
export interface ExecutionPlan {
  id: string;
  description: string;
  stack: SupportedStack;
  targetDir?: string;
  slices: PlannedSlice[];
  qaChecks: ('test' | 'typecheck' | 'lint' | 'build')[];
  overwrite?: boolean;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  steps: PlanStep[];
  createdAt: string;
  updatedAt: string;
}

/** Index entry of an Architecture Decision Record stored under docs/adr/. */
export interface DecisionRecord {
  id: string;
  number: number;
  title: string;
  status: 'proposed' | 'accepted' | 'superseded' | 'deprecated';
  file: string;
  date: string;
}

/** What one session leaves for the next: where it stopped and what comes next. */
export interface HandoffNote {
  id: string;
  summary: string;
  nextSteps: string[];
  openQuestions: string[];
  createdAt: string;
}

export interface QaRunSummary {
  stack: SupportedStack;
  check: string;
  status: 'passed' | 'failed' | 'skipped';
  failed: number;
  total: number;
  at: string;
}

export interface StateManifest {
  metadata: ProjectMetadata;
  facts: CaseFact[];
  ledger: LedgerStep[];
  plans: ExecutionPlan[];
  decisions: DecisionRecord[];
  handoffs: HandoffNote[];
  qaHistory: QaRunSummary[];
}
