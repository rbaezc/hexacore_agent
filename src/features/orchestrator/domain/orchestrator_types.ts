import { ExecutionPlan, PlannedSlice, PlanStep, SupportedStack } from '../../state_management/index.js';
import { QACheck, QAFixAttempt, QAResult } from '../../quality_assurance/index.js';
import { ArchitectureViolation } from '../../architecture/index.js';

export interface UserRequirement {
  id: string;
  description: string;
  targetStack: SupportedStack;
  /** Single-slice shorthand; ignored when `slices` is given. */
  sliceName?: string;
  /** The decomposition, typically produced by the client model from the requirement. */
  slices?: PlannedSlice[];
  targetDir?: string;
  overwrite?: boolean;
  qaChecks?: QACheck[];
  /** Let HexaCore ask the client model for fixes via MCP sampling (default: when available). */
  autoFix?: boolean;
}

export interface OrchestrationResult {
  planId: string;
  plan: ExecutionPlan;
  injectedRules: string;
  steps: PlanStep[];
  success: boolean;
  qa: QAResult[];
  qaAttempts: QAFixAttempt[];
  architectureViolations: ArchitectureViolation[];
  /** Concrete follow-ups for the client model when the run isn't fully green. */
  nextActions: string[];
  message: string;
}
