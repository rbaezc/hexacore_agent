export interface PromptDefinition {
  name: string;
  title: string;
  description: string;
  arguments: { name: string; description: string; required: boolean }[];
  render: (args: Record<string, string>) => string;
}

/** Guided workflows exposed as MCP prompts (slash commands in most clients). */
export const PROMPTS: PromptDefinition[] = [
  {
    name: 'design_feature',
    title: 'Design a feature (design → contract → plan)',
    description: 'Turns a requirement into a reviewed design before any code is generated.',
    arguments: [
      { name: 'requirement', description: 'What the feature must do', required: true },
      { name: 'stack', description: 'Target stack (optional; detected otherwise)', required: false },
    ],
    render: (a) => `Design this feature with HexaCore before writing code.

Requirement: ${a.requirement}
${a.stack ? `Stack: ${a.stack}\n` : ''}
1. Call resume_session to load project context (follow "How this user works" in it), then search_knowledge_base for the rules that apply.
2. Model the domain: entities, their invariants, and the vertical slices (one per use case or cohesive capability). Name each slice.
3. For each slice exposed over HTTP, call define_contract with its operations.
4. For every non-obvious choice (persistence, boundaries between slices, sync vs. events), call record_decision with the alternatives you rejected.
5. Present the design (slices, contracts, decisions) to me and wait for my approval.
6. After approval, call orchestrate_task with the slices and qaChecks ["test","typecheck"], then report the results and nextActions.`,
  },
  {
    name: 'implement_slice',
    title: 'Implement a vertical slice',
    description: 'Scaffold, implement the business logic test-first, and verify.',
    arguments: [
      { name: 'slice', description: 'Slice name', required: true },
      { name: 'behaviour', description: 'What the slice must do', required: true },
    ],
    render: (a) => `Implement the '${a.slice}' slice: ${a.behaviour}

1. search_knowledge_base for the rules of this stack and slice type.
2. execute_scaffolding with dryRun=true, review the plan, then run it for real.
3. Write the tests for the required behaviour first, then the implementation, respecting the layer rules (domain depends on nothing; application only on domain).
4. run_quality_assurance with checks ["test","typecheck","lint"]; fix until green. Never weaken a test to make it pass.
5. check_architecture and fix any violation you introduced.
6. record_handoff summarising what was done and what is left.`,
  },
  {
    name: 'fix_failing_checks',
    title: 'Fix failing quality checks',
    description: 'Diagnose and fix failing tests/type errors without weakening tests.',
    arguments: [{ name: 'stack', description: 'Stack to verify', required: true }],
    render: (a) => `Get the ${a.stack} project green.

1. run_quality_assurance with checks ["test","typecheck"] for stack ${a.stack}.
2. If the result has learning.suggestions, read those lessons first: they are fixes that worked in this project before.
3. For each failure, read the referenced file and line before changing anything; group failures by root cause.
4. Fix implementation code. Tests are the specification: do not edit them unless they are demonstrably wrong — and then say so explicitly.
5. Re-run the checks after each fix. If a change makes things worse, use list_checkpoints/rollback_changes for files HexaCore wrote, or revert your edit.
6. Close the learning loop: rate_lesson for each suggested lesson you used or rejected (HexaCore only credits lessons the fix resembles, so rate the ones it missed); when a check is reported as resolved and the root cause could recur, record_lesson with its episodeId (update an existing lesson with updateId instead of duplicating it).
7. Finish with check_architecture and a short summary of root causes.`,
  },
  {
    name: 'prototype_ui',
    title: 'Prototype a UI (prototype → check → promote)',
    description: 'Designs a page or screen as a live HTML prototype, verifies it in a browser, and takes the approved version into the project.',
    arguments: [
      { name: 'request', description: 'What to design, e.g. "landing page for the product"', required: true },
      { name: 'target', description: 'Where it should end up (optional), e.g. docs/index.html or src/features/landing', required: false },
    ],
    render: (a) => `Prototype this UI with HexaCore before building it.

Request: ${a.request}
${a.target ? `Target: ${a.target}
` : ''}
1. Call resume_session (follow "How this user works"), then search_knowledge_base for "ui conventions" and for any brand or design rules of this project.
2. Settle the design in a few lines before writing: the audience and the page's one job, color tokens for light and dark, type roles, the layout idea. Use real content from the project, never lorem ipsum.
3. create_prototype with a short name${a.target ? ` and target "${a.target}"` : ''} and the full HTML page. Fix any static problems it reports with edits.
4. run_quality_assurance with checks ["ui"] and that target name. Look at the screenshots, fix every failure (use the suggested lessons first), and run it again until it is green.
5. Give me the preview URL and a two-line summary of the design, then wait for my feedback. Apply each round of feedback with edits (a new version each time) and re-check.
6. When I approve, promote_prototype into the target. For a framework target, follow the steps it returns, then verify with checks ["typecheck","test"] and ["ui"] against the dev server URL.
7. If a ui failure went green and the cause could recur, record_lesson with its episodeId.`,
  },
];
