import { StateManifest } from '../domain/state_types.js';

export interface SessionBriefing {
  project: string;
  activeStacks: string[];
  /** Human-readable summary meant to be read first by the model in a new session. */
  briefing: string;
  pendingPlans: { id: string; description: string; status: string; nextStep?: string }[];
  latestHandoff?: StateManifest['handoffs'][number];
  /** For an agent: handoffs addressed to it since its own last handoff, oldest first. */
  handoffsForYou?: StateManifest['handoffs'];
  recentDecisions: StateManifest['decisions'];
  lastQa: StateManifest['qaHistory'];
  recentCheckpoints: { id: string; label: string; createdAt: string; status: string }[];
}

/** Condenses the manifest into what a fresh session needs to continue, instead of dumping raw JSON. */
export function buildBriefing(
  state: StateManifest,
  checkpoints: { id: string; label: string; createdAt: string; status: string }[],
  agent?: string
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
  const handoffsForYou = agent ? addressedTo(state.handoffs, agent) : undefined;
  for (const h of handoffsForYou ?? []) {
    lines.push(`For you (${agent}) from ${h.from ?? 'a session'} at ${h.createdAt}: ${h.summary}`);
    if (h.nextSteps.length) lines.push(`  Asked next: ${h.nextSteps.join('; ')}`);
    if (h.openQuestions.length) lines.push(`  Open questions: ${h.openQuestions.join('; ')}`);
  }
  if (latestHandoff && !handoffsForYou?.includes(latestHandoff)) {
    lines.push(`Last session (${latestHandoff.createdAt}): ${latestHandoff.summary}`);
    if (latestHandoff.nextSteps.length) lines.push(`Planned next: ${latestHandoff.nextSteps.join('; ')}`);
    if (latestHandoff.openQuestions.length) lines.push(`Open questions: ${latestHandoff.openQuestions.join('; ')}`);
  }
  for (const p of pendingPlans) lines.push(`Unfinished plan ${p.id} (${p.status}): "${p.description}" — next: ${p.nextStep ?? 'n/a'}. Continue with resume_plan.`);
  const red = lastQa.filter((q) => q.status === 'failed');
  if (red.length) {
    const describe = (q: (typeof red)[number]) => `${q.stack}/${q.check} (${q.failed} failing${q.source === 'watch' ? `, seen by watch mode at ${q.at}` : ''})`;
    lines.push(`Failing checks at last run: ${red.map(describe).join(', ')}.`);
  }
  if (recentDecisions.length) lines.push(`Recent decisions: ${recentDecisions.map((d) => `ADR ${d.number} ${d.title}`).join('; ')}.`);
  if (lines.length === 1) lines.push('No previous work recorded.');

  return {
    project: state.metadata.projectName,
    activeStacks: state.metadata.activeStacks,
    briefing: lines.join('\n'),
    pendingPlans,
    latestHandoff,
    ...(handoffsForYou ? { handoffsForYou } : {}),
    recentDecisions,
    lastQa,
    recentCheckpoints: checkpoints.slice(0, 5),
  };
}

/** Handoffs addressed to `agent` since it last handed something over itself (at most 3, oldest first). */
function addressedTo(handoffs: StateManifest['handoffs'], agent: string): StateManifest['handoffs'] {
  const lastOwn = handoffs.map((h) => h.from).lastIndexOf(agent);
  return handoffs.slice(lastOwn + 1).filter((h) => h.to === agent).slice(-3);
}
