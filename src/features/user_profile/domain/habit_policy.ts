import { Habit, ToolCallEvent, UsageCounters } from './profile_types.js';

const MIN_STACK_EVENTS = 5;
const MIN_STACK_SHARE = 0.2;
const MIN_QA_RUNS = 5;
const MIN_QA_SHARE = 0.6;
const MIN_SCAFFOLDS = 3;
const MIN_WRITES = 5;
const ROLLBACK_SHARE = 0.25;

/** Tools that change project files through a checkpoint (what a rollback undoes). */
const WRITING_TOOLS = new Set(['execute_scaffolding', 'orchestrate_task', 'record_decision', 'define_contract', 'record_lesson', 'merge_lessons', 'export_skills', 'create_prototype', 'promote_prototype']);

const COUNTED_TOOLS = new Set(['resume_session', 'run_quality_assurance', 'rollback_changes', ...WRITING_TOOLS]);

/** Whether a call says anything about habits (so other calls don't touch the profile file). Failed calls never do. */
export function isHabitEvidence(event: ToolCallEvent): boolean {
  return event.ok && (COUNTED_TOOLS.has(event.tool) || typeof event.args.stack === 'string' || typeof event.args.targetStack === 'string');
}

/** Folds one tool call into the usage counters. */
export function recordEvent(usage: UsageCounters, event: ToolCallEvent): void {
  if (!isHabitEvidence(event)) return;
  const args = event.args;
  const stack = typeof args.stack === 'string' ? args.stack : typeof args.targetStack === 'string' ? args.targetStack : undefined;
  if (stack) usage.stacks[stack] = (usage.stacks[stack] ?? 0) + 1;

  switch (event.tool) {
    case 'resume_session':
      usage.sessions++;
      break;
    case 'run_quality_assurance': {
      const checks = Array.isArray(args.checks) && args.checks.length ? [...new Set(args.checks.map(String))].sort().join(',') : 'test';
      usage.qaCheckSets[checks] = (usage.qaCheckSets[checks] ?? 0) + 1;
      break;
    }
    case 'execute_scaffolding':
      if (args.dryRun === true) usage.scaffolds.previewed++;
      else usage.scaffolds.written++;
      break;
    case 'rollback_changes':
      usage.rollbacks++;
      break;
  }
  if (WRITING_TOOLS.has(event.tool) && !(event.tool === 'execute_scaffolding' && args.dryRun === true)) usage.writes++;
}

/** Habits backed by enough evidence; phrased as guidance the model can act on. */
export function deriveHabits(usage: UsageCounters): Habit[] {
  const habits: Habit[] = [];

  const stackTotal = sum(usage.stacks);
  if (stackTotal >= MIN_STACK_EVENTS) {
    const main = Object.entries(usage.stacks)
      .map(([stack, n]) => ({ stack, share: n / stackTotal }))
      .filter((s) => s.share >= MIN_STACK_SHARE)
      .sort((a, b) => b.share - a.share);
    if (main.length) habits.push({ id: 'stacks', text: `Works mostly in ${main.map((s) => `${s.stack} (${pct(s.share)})`).join(', ')}.`, evidence: stackTotal });
  }

  const qaTotal = sum(usage.qaCheckSets);
  const [topChecks, topCount] = Object.entries(usage.qaCheckSets).sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
  if (qaTotal >= MIN_QA_RUNS && topCount / qaTotal >= MIN_QA_SHARE) {
    habits.push({ id: 'qa_checks', text: `Usually verifies with checks [${topChecks.split(',').join(', ')}]: use them by default.`, evidence: qaTotal });
  }

  const { written, previewed } = usage.scaffolds;
  if (written + previewed >= MIN_SCAFFOLDS && previewed >= written * 0.8 && previewed > 0) {
    habits.push({ id: 'previews', text: 'Previews scaffolding (dryRun) before writing: show the plan first.', evidence: written + previewed });
  }

  if (usage.writes >= MIN_WRITES && usage.rollbacks / usage.writes >= ROLLBACK_SHARE) {
    habits.push({
      id: 'rollbacks',
      text: `Rolls back ${pct(usage.rollbacks / usage.writes)} of HexaCore's changes: confirm the plan before writing, and keep changes small.`,
      evidence: usage.writes,
    });
  }
  return habits;
}

/**
 * Preferences are stored in plain text and shown in every briefing: refuse anything that looks like
 * a credential rather than a working preference.
 */
export function looksSensitive(text: string): boolean {
  return /\b(api[_-]?key|token|password|passwd|secret|bearer)\b\s*[:=]/i.test(text) || /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/.test(text) || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text);
}

function sum(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}
