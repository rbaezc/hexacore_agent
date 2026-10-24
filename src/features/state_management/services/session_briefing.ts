import { StateManifest } from '../domain/state_types.js';

export interface SessionBriefing {
  project: string;
  activeStacks: string[];
  /** Human-readable summary meant to be read first by the model in a new session. */
  briefing: string;
  pendingPlans: { id: string; description: string; status: string; nextStep?: string }[];
  latestHandoff?: StateManifest['handoffs'][number];
  recentDecisions: StateManifest['decisions'];
  lastQa: StateManifest['qaHistory'];
  recentCheckpoints: { id: string; label: string; createdAt: string; status: string }[];
}

/** Condenses the manifest into what a fresh session needs to continue, instead of dumping raw JSON. */
export function buildBriefing(
  state: StateManifest,
  checkpoints: { id: string; label: string; createdAt: string; status: string }[]
): SessionBriefing {
  const pendingPlans = state.plans
    .filter((p) => p.status !== 'completed')
    .slice(-5)
    .map((p) => ({
      id: p.id,
      description: p.description,
      status: p.status,
      nextStep: p.steps.find((s) => s.status !== 'completed')?.title,
    }));

  // Latest result per (stack, check) pair.
  const latestQa = new Map<string, StateManifest['qaHistory'][number]>();
  for (const run of state.qaHistory) latestQa.set(`${run.stack}:${run.check}`, run);
  const lastQa = [...latestQa.values()];

  const latestHandoff = state.handoffs[state.handoffs.length - 1];
  const recentDecisions = state.decisions.slice(-5);

  const lines: string[] = [`Project '${state.metadata.projectName}' (stacks: ${state.metadata.activeStacks.join(', ') || 'not detected yet'}).`];
  if (latestHandoff) {
    lines.push(`Last session (${latestHandoff.createdAt}): ${latestHandoff.summary}`);
    if (latestHandoff.nextSteps.length) lines.push(`Planned next: ${latestHandoff.nextSteps.join('; ')}`);
    if (latestHandoff.openQuestions.length) lines.push(`Open questions: ${latestHandoff.openQuestions.join('; ')}`);
  }
  for (const p of pendingPlans) lines.push(`Unfinished plan ${p.id} (${p.status}): "${p.description}" — next: ${p.nextStep ?? 'n/a'}. Continue with resume_plan.`);
  const red = lastQa.filter((q) => q.status === 'failed');
  if (red.length) lines.push(`Failing checks at last run: ${red.map((q) => `${q.stack}/${q.check} (${q.failed} failing)`).join(', ')}.`);
  if (recentDecisions.length) lines.push(`Recent decisions: ${recentDecisions.map((d) => `ADR ${d.number} ${d.title}`).join('; ')}.`);
  if (lines.length === 1) lines.push('No previous work recorded.');

  return {
    project: state.metadata.projectName,
    activeStacks: state.metadata.activeStacks,
    briefing: lines.join('\n'),
    pendingPlans,
    latestHandoff,
    recentDecisions,
    lastQa,
    recentCheckpoints: checkpoints.slice(0, 5),
  };
}
