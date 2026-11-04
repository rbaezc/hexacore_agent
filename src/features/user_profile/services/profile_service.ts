import { IFileSystem } from '../../../shared/infrastructure/file_system.js';
import { JsonFileStore } from '../../../shared/infrastructure/json_file_store.js';
import { Result, ok, fail } from '../../../shared/domain/result.js';
import { Preference, PreferenceInput, PreferenceScope, ProfileStore, ToolCallEvent, UserProfile, emptyUsage } from '../domain/profile_types.js';
import { deriveHabits, isHabitEvidence, looksSensitive, recordEvent } from '../domain/habit_policy.js';

const MAX_PREFERENCES = 50;
const MAX_TEXT = 500;

export interface ProfileLocations {
  /** ~/.hexacore/profile.json; undefined when the user profile is disabled. */
  user?: () => string;
  /** .hexagen/profile.json of the current workspace. */
  project: () => string;
}

/**
 * A model of how the user works, built across sessions: preferences the user stated (remembered by
 * the model) plus habits derived from what they actually do with HexaCore. Local files only.
 */
export class ProfileService {
  private readonly stores: Partial<Record<PreferenceScope, JsonFileStore<ProfileStore>>>;

  constructor(fileSystem: IFileSystem, locations: ProfileLocations) {
    this.stores = {
      project: new JsonFileStore(fileSystem, locations.project, normalize),
      ...(locations.user ? { user: new JsonFileStore(fileSystem, locations.user, normalize) } : {}),
    };
  }

  get userProfileEnabled(): boolean {
    return Boolean(this.stores.user);
  }

  /** Called by the tool registry after every call. Never throws: observing must not break a tool. */
  async observe(event: ToolCallEvent): Promise<void> {
    if (!isHabitEvidence(event)) return;
    await this.stores.user?.update((doc) => recordEvent(doc.usage, event)).catch(() => undefined);
  }

  async remember(input: PreferenceInput): Promise<Result<Preference, Error>> {
    const text = input.text.trim().replace(/\s+/g, ' ');
    if (text.length < 3 || text.length > MAX_TEXT) return fail(new Error(`A preference is one sentence of 3 to ${MAX_TEXT} characters.`));
    if (looksSensitive(text)) return fail(new Error('That looks like a credential. Preferences are stored in plain text: never store secrets in them.'));
    const scope = input.scope ?? (input.replaceId ? await this.scopeOf(input.replaceId) : undefined) ?? 'user';
    const store = this.stores[scope];
    if (!store) return fail(new Error('The user profile is disabled (HEXACORE_PROFILE=off). Use scope "project".'));

    const saved = await store.update((doc) => {
      const now = new Date().toISOString();
      const existing = input.replaceId ? doc.preferences.find((p) => p.id === input.replaceId) : doc.preferences.find((p) => p.text.toLowerCase() === text.toLowerCase());
      if (input.replaceId && !existing) return undefined;
      if (existing) {
        // Restating a preference refreshes it; only replaceId rewrites its wording.
        Object.assign(existing, input.replaceId ? { text, category: input.category ?? existing.category } : {}, { updatedAt: now });
        return { ...existing };
      }
      const preference: Preference = { id: `pref_${Date.now().toString(36)}_${doc.preferences.length + 1}`, text, category: input.category ?? 'other', scope, createdAt: now, updatedAt: now };
      doc.preferences = [...doc.preferences, preference].slice(-MAX_PREFERENCES);
      return preference;
    });
    if (saved.isFailure) return fail(saved.error);
    return saved.value ? ok(saved.value) : fail(new Error(`Preference '${input.replaceId}' not found in the ${scope} profile.`));
  }

  private async scopeOf(id: string): Promise<PreferenceScope | undefined> {
    for (const [scope, store] of Object.entries(this.stores)) {
      const loaded = await store!.load();
      if (loaded.isSuccess && loaded.value.preferences.some((p) => p.id === id)) return scope as PreferenceScope;
    }
    return undefined;
  }

  /** Removes one preference by id, or everything: `all` (preferences of both scopes and observed habits) / `observed` (habits only). */
  async forget(input: { id?: string; all?: boolean; observed?: boolean }): Promise<Result<{ removed: number; observedReset: boolean }, Error>> {
    let removed = 0;
    for (const store of Object.values(this.stores)) {
      const result = await store!.update((doc) => {
        const before = doc.preferences.length;
        doc.preferences = input.all ? [] : doc.preferences.filter((p) => p.id !== input.id);
        if (input.all || input.observed) doc.usage = emptyUsage();
        return before - doc.preferences.length;
      });
      if (result.isFailure) return fail(result.error);
      removed += result.value;
    }
    if (input.id && !input.all && removed === 0) return fail(new Error(`Preference '${input.id}' not found.`));
    return ok({ removed, observedReset: Boolean(input.all || input.observed) && this.userProfileEnabled });
  }

  async profile(): Promise<Result<UserProfile, Error>> {
    const preferences: Preference[] = [];
    let habits: UserProfile['habits'] = [];
    for (const [scope, store] of Object.entries(this.stores)) {
      const loaded = await store!.load();
      if (loaded.isFailure) return fail(loaded.error);
      preferences.push(...loaded.value.preferences);
      if (scope === 'user') habits = deriveHabits(loaded.value.usage);
    }
    return ok({ preferences, habits });
  }
}

function normalize(parsed: any): ProfileStore {
  const usage = { ...emptyUsage(), ...(parsed?.usage ?? {}) };
  usage.scaffolds = { ...emptyUsage().scaffolds, ...(parsed?.usage?.scaffolds ?? {}) };
  return { version: 1, preferences: Array.isArray(parsed?.preferences) ? parsed.preferences : [], usage };
}
