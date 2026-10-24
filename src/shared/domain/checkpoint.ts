export interface FileChange {
  /** Absolute path of the touched file. */
  path: string;
  /** Content before HexaCore first touched the file in this checkpoint; null = the file did not exist. */
  original: string | null;
  /** Content HexaCore last wrote; used to detect edits made by someone else afterwards. */
  written: string;
}

export interface Checkpoint {
  id: string;
  label: string;
  createdAt: string;
  status: 'open' | 'rolled_back';
  changes: FileChange[];
}

export interface RollbackReport {
  checkpointId: string;
  /** False when conflicts blocked the rollback; nothing was changed in that case. */
  applied: boolean;
  restored: string[];
  deleted: string[];
  /** Files modified after HexaCore wrote them; while any exist the rollback is refused unless `force` is set. */
  conflicts: string[];
}
