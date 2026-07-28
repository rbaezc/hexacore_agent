import { SupportedStack } from '../../state_management/domain/state_types.js';

export interface ScaffoldOptions {
  stack: SupportedStack;
  sliceName: string;
  layer?: 'domain' | 'application' | 'infrastructure' | 'presentation' | 'full';
  targetDir?: string;
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface ScaffoldResult {
  sliceName: string;
  stack: SupportedStack;
  createdFiles: string[];
  success: boolean;
  message: string;
}
