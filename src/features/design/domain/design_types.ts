export interface DecisionInput {
  title: string;
  context: string;
  decision: string;
  consequences: string;
  alternatives?: string[];
  status?: 'proposed' | 'accepted';
  /** Slices/areas the decision applies to, for retrieval. */
  tags?: string[];
}

export type FieldType = 'string' | 'integer' | 'number' | 'boolean' | 'datetime';

export interface ContractField {
  name: string;
  type: FieldType;
  required?: boolean;
  description?: string;
}

export interface ContractOperation {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Relative to the slice, e.g. "/" or "/{id}". */
  path: string;
  summary: string;
  request?: ContractField[];
  response?: ContractField[];
  /** HTTP status of the success response (default 200, 201 for POST). */
  successStatus?: number;
}

export interface ContractInput {
  sliceName: string;
  title?: string;
  version?: string;
  operations: ContractOperation[];
  /** Directory for the contract file, relative to the workspace (default "contracts"). */
  outputDir?: string;
}
