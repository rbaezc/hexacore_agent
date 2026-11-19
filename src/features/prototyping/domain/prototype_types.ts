import { AttachedImage } from '../../../shared/domain/attachments.js';

/** One saved state of a prototype. Versions are immutable; the prototype directory always holds the current one. */
export interface PrototypeVersion {
  version: number;
  createdAt: string;
  /** The version this one was derived from (edits are applied to it). */
  basedOn?: number;
  note?: string;
  files: string[];
  checkpointId: string;
}

export interface Promotion {
  version: number;
  target: string;
  checkpointId: string;
  at: string;
}

export interface PrototypeMeta {
  name: string;
  /** Where the prototype is meant to end up (a page like docs/index.html, or a slice). */
  target?: string;
  createdAt: string;
  updatedAt: string;
  current: number;
  versions: PrototypeVersion[];
  promotions: Promotion[];
}

export interface TextEdit {
  oldText: string;
  newText: string;
}

export interface PrototypeInput {
  name: string;
  /** Full page; or use `edits` to change the version in `basedOn` (default: the current one). */
  html?: string;
  edits?: TextEdit[];
  /** Extra text files next to index.html (styles.css, app.js…), relative to the prototype. */
  files?: { path: string; content: string }[];
  basedOn?: number;
  target?: string;
  note?: string;
}

export interface SavedPrototype {
  meta: PrototypeMeta;
  version: PrototypeVersion;
  /** Absolute directory holding the current version. */
  dir: string;
  checkpointId: string;
}

export type FindingSeverity = 'error' | 'warning';

/** One UI problem, located as precisely as the audit can (source line for static rules, element for rendered ones). */
export interface UiFinding {
  rule: string;
  severity: FindingSeverity;
  message: string;
  /** Workspace-relative file. */
  file?: string;
  line?: number;
  selector?: string;
  viewport?: 'mobile' | 'desktop';
  theme?: 'light' | 'dark';
}

/** What the 'ui' check audits: page files (static + rendered) or a local dev-server URL (rendered only). */
export interface UiTarget {
  label: string;
  /** Directory the check runs in: the learning loop compares this directory before and after a fix. */
  cwd: string;
  files: string[];
  /** Rendered URL; a preview-server URL for prototypes, file:// for other pages, or a localhost dev server. */
  url?: string;
  prototype?: { name: string; version: number };
}

export interface UiAuditReport {
  target: string;
  /** Rule ids that ran: the denominator for passed/failed counts. */
  rulesChecked: string[];
  findings: UiFinding[];
  rendered: boolean;
  /** Why the browser part did not run (Playwright missing, preview disabled…). */
  renderSkipped?: string;
  screenshots: string[];
  images: AttachedImage[];
}
