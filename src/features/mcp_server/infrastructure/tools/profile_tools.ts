import { z } from 'zod';
import { fail } from '../../../../shared/domain/result.js';
import type { HexaCoreServices } from '../../../../composition_root.js';
import { PreferenceInput } from '../../../user_profile/index.js';
import { ToolDefinition } from '../../domain/mcp_types.js';

/** The user model: stated preferences (remembered by the model) and observed habits, shown in every briefing. */
export function profileTools(s: HexaCoreServices): ToolDefinition[] {
  return [
    {
      name: 'remember_preference',
      title: 'Remember a user preference',
      description:
        "Remembers how the user likes to work, so every future session starts with it (resume_session). Call when the user states a lasting preference or corrects you in a way that should stick: code style, conventions, workflow (e.g. \"always show the plan before writing\"), how they want answers. One sentence, phrased as guidance. scope user (default) follows them to every project; project applies here only. Never store secrets or personal data. replaceId rewrites one.",
      schema: () =>
        z.object({
          text: z.string().min(3).describe('The preference, as guidance, e.g. "Prefers small PRs with one slice each"'),
          category: z.enum(['style', 'workflow', 'communication', 'tooling', 'other']).optional(),
          scope: z.enum(['user', 'project']).optional(),
          replaceId: z.string().optional().describe('Preference id to rewrite'),
        }),
      handler: async (args: PreferenceInput) => s.profile.remember(args),
    },
    {
      name: 'forget_preference',
      title: 'Forget user preferences',
      description:
        'Removes a remembered preference (id, from resume_session profile), or resets the observed habits (observed=true), or everything HexaCore knows about how the user works (all=true). Use when the user asks you to forget something or a preference is outdated.',
      schema: () =>
        z.object({
          id: z.string().optional(),
          observed: z.boolean().optional().describe('Reset the observed habits'),
          all: z.boolean().optional().describe('Forget all preferences and habits'),
        }),
      handler: async (args: { id?: string; observed?: boolean; all?: boolean }) => {
        if (!args.id && !args.observed && !args.all) return fail(new Error('Pass id, observed=true or all=true.'));
        return s.profile.forget(args);
      },
    },
  ];
}
