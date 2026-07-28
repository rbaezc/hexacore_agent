import { SupportedStack } from '../../state_management/domain/state_types.js';

export interface UserRequirement {
  id: string;
  description: string;
  targetStack: SupportedStack;
  sliceName: string;
}

export interface ExecutionStep {
  id: string;
  name: string;
  action: 'rag_inquire' | 'scaffold' | 'qa_check';
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  output?: string;
}

export interface OrchestrationResult {
  planId: string;
  requirement: UserRequirement;
  injectedRules: string;
  steps: ExecutionStep[];
  success: boolean;
  message: string;
}
