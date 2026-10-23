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
1. Call resume_session to load project context, then search_knowledge_base for the rules that apply.
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
2. For each failure, read the referenced file and line before changing anything; group failures by root cause.
3. Fix implementation code. Tests are the specification: do not edit them unless they are demonstrably wrong — and then say so explicitly.
4. Re-run the checks after each fix. If a change makes things worse, use list_checkpoints/rollback_changes for files HexaCore wrote, or revert your edit.
5. Finish with check_architecture and a short summary of root causes.`,
  },
];
