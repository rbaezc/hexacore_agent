/** user = follows the user to every project (~/.hexacore/profile.json); project = this project only (.hexagen/profile.json). */
export type PreferenceScope = 'user' | 'project';

export type PreferenceCategory = 'style' | 'workflow' | 'communication' | 'tooling' | 'other';

/** Something the user told the model about how they like to work. */
export interface Preference {
  id: string;
  text: string;
  category: PreferenceCategory;
  scope: PreferenceScope;
  createdAt: string;
  updatedAt: string;
}

/** Counters of what the user actually does with HexaCore, from which habits are derived. */
export interface UsageCounters {
  sessions: number;
  stacks: Record<string, number>;
  /** QA runs by the sorted set of checks requested, e.g. "lint,test,typecheck". */
  qaCheckSets: Record<string, number>;
  scaffolds: { written: number; previewed: number };
  /** Successful calls that changed project files through a checkpoint. */
  writes: number;
  rollbacks: number;
}

export interface ProfileStore {
  version: 1;
  preferences: Preference[];
  usage: UsageCounters;
}

/** A pattern observed in the usage counters, with the evidence behind it. */
export interface Habit {
  id: 'stacks' | 'qa_checks' | 'previews' | 'rollbacks';
  text: string;
  evidence: number;
}

/** What the tool registry reports after every call. */
export interface ToolCallEvent {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
}

export interface PreferenceInput {
  text: string;
  category?: PreferenceCategory;
  scope?: PreferenceScope;
  /** Rewrite an existing preference instead of adding one. */
  replaceId?: string;
}

export interface UserProfile {
  preferences: Preference[];
  habits: Habit[];
}

export function emptyUsage(): UsageCounters {
  return { sessions: 0, stacks: {}, qaCheckSets: {}, scaffolds: { written: 0, previewed: 0 }, writes: 0, rollbacks: 0 };
}
