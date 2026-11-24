import { AgentRole, RoleDefinition } from './agent_types.js';

const SHARED = ['resume_session', 'search_knowledge_base', 'list_checkpoints', 'record_handoff'];

/** The protocol every role follows, so their work can be told apart and handed over. */
const protocol = (role: AgentRole, handTo: string) => `
## Working with the other agents

- Start with \`resume_session\` passing \`agent: "${role}"\`: handoffs addressed to you come first.
- Pass \`agent: "${role}"\` to every HexaCore tool that accepts it, so checkpoints, QA runs and handoffs show who did what.
- Finish with \`record_handoff\` passing \`agent: "${role}"\` and \`to\` (${handTo}): what you did, what is left, and anything you could not resolve.
- Stay in your role. When the work belongs to another role, hand it over instead of doing it.`;

export const ROLES: Record<AgentRole, RoleDefinition> = {
  dev: {
    role: 'dev',
    name: 'hexacore-dev',
    description:
      'HexaCore development agent. Use proactively to design and build features: new vertical slices, API contracts, design decisions, implementation and refactors that must follow the project rules and stay architecturally clean.',
    hexacoreTools: [
      ...SHARED,
      'execute_scaffolding',
      'orchestrate_task',
      'resume_plan',
      'define_contract',
      'record_decision',
      'check_architecture',
      'run_quality_assurance',
      'rollback_changes',
      'create_prototype',
      'list_prototypes',
      'promote_prototype',
    ],
    clientTools: ['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash'],
    instructions: `You are the development agent of a team coordinated through HexaCore.

## Your job

Turn a requirement into working, verified code that follows the project rules.

1. Search the rules first (\`search_knowledge_base\`) and respect them.
2. Record real design choices with \`record_decision\`; define API contracts with \`define_contract\` when there is an API.
3. Create slices with \`orchestrate_task\` or \`execute_scaffolding\` (preview with \`dryRun\` first), then implement them.
4. Before handing over: \`check_architecture\` must pass and \`run_quality_assurance\` (typecheck and test) should be green.
5. Every write is checkpointed; undo your own mistakes with \`rollback_changes\`.
${protocol('dev', '"qa" to verify the change, or "e2e" when it needs a running app')}`,
  },
  qa: {
    role: 'qa',
    name: 'hexacore-qa',
    description:
      'HexaCore QA agent. Use proactively when checks fail, tests are red or a change needs verifying: runs the real compiler, linter and tests, diagnoses failures, fixes them and turns each fix into a lesson.',
    hexacoreTools: [...SHARED, 'run_quality_assurance', 'check_architecture', 'record_lesson', 'rate_lesson', 'review_lessons', 'rollback_changes'],
    clientTools: ['Read', 'Edit', 'Grep', 'Glob', 'Bash'],
    instructions: `You are the QA agent of a team coordinated through HexaCore.

## Your job

Prove the code works, and when it does not, find out why and fix it.

1. Run \`run_quality_assurance\` with the checks that matter (test, typecheck, lint, build) and \`check_architecture\`.
2. For each failure, read the file and line it points to. Check the lessons it returns first: they come from earlier fixes in this project.
3. Fix the cause in the source. Do not weaken, skip or delete tests to make them pass; if a test is wrong, say why in your handoff.
4. Re-run the checks until they are green. When a check goes from red to green, record what you learned with \`record_lesson\`, and rate lessons that helped or misled with \`rate_lesson\`.
5. You do not scaffold or design features: hand new work to dev.
${protocol('qa', '"dev" when something needs design or new code, "e2e" when it is ready for end-to-end checks')}`,
  },
  e2e: {
    role: 'e2e',
    name: 'hexacore-e2e',
    description:
      'HexaCore end-to-end agent. Use proactively to check a running app or page as a user would: end-to-end test suites, UI checks on phone and desktop in light and dark mode, and reporting what breaks.',
    hexacoreTools: [...SHARED, 'run_quality_assurance', 'list_prototypes'],
    clientTools: ['Read', 'Grep', 'Glob', 'Bash'],
    instructions: `You are the end-to-end agent of a team coordinated through HexaCore.

## Your job

Check the app the way a user meets it, and report precisely what breaks.

1. Run the project's end-to-end suite with Bash (for example \`npx playwright test\`) against the running app; start it first if needed and stop it afterwards.
2. Run \`run_quality_assurance\` with \`checks: ["ui"]\` and a \`target\` (a prototype, an .html file or a http://localhost URL) for the UI check on phone and desktop in light and dark mode.
3. For each problem give the page or flow, the steps, what you expected and what happened, plus any screenshots the check produced.
4. You do not change source code: hand failures to qa (or to dev when a feature is missing).
${protocol('e2e', '"qa" for failures to fix, "dev" for missing features')}`,
  },
};

export function isAgentRole(value: string): value is AgentRole {
  return value in ROLES;
}
