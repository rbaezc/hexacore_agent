#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHexaCore } from '../composition_root.js';
import { createToolRegistry } from '../features/mcp_server/infrastructure/mcp_server_factory.js';
import { getPackageVersion } from '../shared/infrastructure/package_info.js';

const BOOLEAN_FLAGS = new Set(['dryRun', 'overwrite', 'force', 'noTests']);

/** Splits argv into positional arguments and `--flag [value]` options in a single pass. */
function parseArgs(argv: string[]): { positional: string[]; flags: Record<string, string | boolean> } {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].match(/^--(\w+)$/)?.[1];
    if (!key) {
      positional.push(argv[i]);
    } else if (BOOLEAN_FLAGS.has(key) || argv[i + 1] === undefined || argv[i + 1].startsWith('--')) {
      flags[key] = true;
    } else {
      flags[key] = argv[++i];
    }
  }
  return { positional, flags };
}

const USAGE = `Usage: hexacore <command> [args] [--workspace <dir>]
  state                                   Session briefing (.hexagen/state.json)
  rag <query…>                            Search architecture rules
  scaffold <stack> <name> [--targetDir d] [--layer l] [--dryRun] [--overwrite] [--noTests]
  qa <stack> [--checks test,typecheck,lint,build] [--scope s] [--cwd d]
  arch [path]                             Architecture audit
  orchestrate <stack> <slice[,slice…]> [--description text] [--targetDir d] [--checks …]
  resume <planId>                         Continue a persisted plan
  checkpoints                             List checkpoints
  rollback <checkpointId> [--force]       Undo a checkpoint
  lessons [query…] [--stack s]            Review learned lessons (or search them)
  export-skills [lessonId,…]              Export proven lessons as Claude Code skills`;

/** Maps CLI arguments to a tool call. Returns undefined for unknown commands. */
function toToolCall(command: string, args: string[], flags: Record<string, string | boolean>): { tool: string; input: Record<string, unknown> } | undefined {
  const list = (v: string | boolean | undefined) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined);
  const str = (v: string | boolean | undefined) => (typeof v === 'string' ? v : undefined);
  switch (command) {
    case 'state':
      return { tool: 'resume_session', input: {} };
    case 'rag':
      return { tool: 'search_knowledge_base', input: { query: args.join(' ') || 'vertical slice rules' } };
    case 'scaffold':
      return {
        tool: 'execute_scaffolding',
        input: {
          stack: args[0],
          sliceName: args[1],
          targetDir: str(flags.targetDir),
          layer: str(flags.layer),
          dryRun: flags.dryRun === true || undefined,
          overwrite: flags.overwrite === true || undefined,
          includeTests: flags.noTests === true ? false : undefined,
        },
      };
    case 'qa':
      return { tool: 'run_quality_assurance', input: { stack: args[0], checks: list(flags.checks), scope: str(flags.scope), cwd: str(flags.cwd) } };
    case 'arch':
      return { tool: 'check_architecture', input: { path: args[0] } };
    case 'orchestrate':
      return {
        tool: 'orchestrate_task',
        input: {
          targetStack: args[0],
          slices: (args[1] ?? '').split(',').filter(Boolean).map((name) => ({ name })),
          description: str(flags.description) ?? `Create ${args[1]}`,
          targetDir: str(flags.targetDir),
          qaChecks: list(flags.checks),
        },
      };
    case 'resume':
      return { tool: 'resume_plan', input: { planId: args[0] } };
    case 'checkpoints':
      return { tool: 'list_checkpoints', input: {} };
    case 'rollback':
      return { tool: 'rollback_changes', input: { checkpointId: args[0], force: flags.force === true || undefined } };
    case 'lessons':
      return { tool: 'review_lessons', input: { query: args.join(' ') || undefined, stack: str(flags.stack) } };
    case 'export-skills':
      return { tool: 'export_skills', input: { lessonIds: list(args[0]) } };
    default:
      return undefined;
  }
}

export async function runHexaCoreCLI(argv: string[]): Promise<number> {
  const [command = 'help', ...rest] = argv;
  const { positional, flags } = parseArgs(rest);

  // Banner on stderr so stdout stays machine-readable JSON.
  console.error(`HexaCore Agent CLI v${getPackageVersion()}`);
  const call = toToolCall(command, positional, flags);
  if (!call) {
    console.error(USAGE);
    return command === 'help' ? 0 : 1;
  }

  const services = createHexaCore({ workspaceRoot: typeof flags.workspace === 'string' ? flags.workspace : undefined });
  const registry = createToolRegistry(services);
  const input = Object.fromEntries(Object.entries(call.input).filter(([, v]) => v !== undefined));
  const result = await registry.call(call.tool, input, { reportProgress: async (m) => void console.error(`  … ${m}`) });

  if (result.isFailure) {
    console.error(`Error: ${result.error.message}`);
    return 1;
  }
  console.log(JSON.stringify(result.value, null, 2));
  const value = result.value as { passed?: boolean; success?: boolean };
  return value.passed === false || value.success === false ? 2 : 0;
}

// Compares real paths so this matches through npm's bin symlinks, relative argv, drive-letter casing and separators.
const isMainModule = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMainModule) {
  runHexaCoreCLI(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('CLI Error:', err);
      process.exit(1);
    });
}
