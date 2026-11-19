#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHexaCore } from '../composition_root.js';
import { createToolRegistry } from '../features/mcp_server/infrastructure/mcp_server_factory.js';
import { getPackageVersion } from '../shared/infrastructure/package_info.js';

const BOOLEAN_FLAGS = new Set(['dryRun', 'overwrite', 'force', 'noTests', 'strict', 'open']);

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
  qa <stack> [--checks test,typecheck,lint,build,ui] [--scope s] [--cwd d] [--target t]
  ui [target]                             UI check of a prototype, an .html file or a localhost URL
  arch [path] [--strict]                  Architecture audit (--strict: warnings fail too)
  orchestrate <stack> <slice[,slice…]> [--description text] [--targetDir d] [--checks …]
  resume <planId>                         Continue a persisted plan
  checkpoints                             List checkpoints
  rollback <checkpointId> [--force]       Undo a checkpoint
  lessons [query…] [--stack s]            Review learned lessons (or search them)
  export-skills [lessonId,…]              Export proven lessons as Claude Code skills
  share-lessons [lessonId,…]              Share proven lessons with your other projects (~/.hexacore)
  prototype <name> <file.html> [--note n] [--target t]   Save a file as a new prototype version
  prototypes                              List prototypes and their preview URLs
  promote <name> <target> [--version n] [--overwrite]    Copy a prototype into the project
  preview [--port p] [--open]             Serve .hexagen/prototypes on 127.0.0.1 until Ctrl+C`;

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
      return { tool: 'run_quality_assurance', input: { stack: args[0], checks: list(flags.checks), scope: str(flags.scope), cwd: str(flags.cwd), target: str(flags.target) } };
    case 'ui':
      // The stack only labels the result; it is filled in from the workspace before the call.
      return { tool: 'run_quality_assurance', input: { checks: ['ui'], target: args[0] } };
    case 'prototype':
      return { tool: 'create_prototype', input: { name: args[0], html: args[1] ? readFileSync(args[1], 'utf-8') : undefined, note: str(flags.note), target: str(flags.target) } };
    case 'prototypes':
      return { tool: 'list_prototypes', input: {} };
    case 'promote':
      return { tool: 'promote_prototype', input: { name: args[0], target: args[1], version: flags.version ? Number(flags.version) : undefined, overwrite: flags.overwrite === true || undefined } };
    case 'arch':
      return { tool: 'check_architecture', input: { path: args[0], strict: flags.strict === true || undefined } };
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
    case 'share-lessons':
      return { tool: 'share_lessons', input: { lessonIds: list(args[0]) } };
    default:
      return undefined;
  }
}

export async function runHexaCoreCLI(argv: string[]): Promise<number> {
  const [command = 'help', ...rest] = argv;
  const { positional, flags } = parseArgs(rest);

  // Banner on stderr so stdout stays machine-readable JSON.
  console.error(`HexaCore Agent CLI v${getPackageVersion()}`);
  const workspaceRoot = typeof flags.workspace === 'string' ? flags.workspace : undefined;
  if (command === 'preview') return servePreviews(workspaceRoot, flags);
  let call: ReturnType<typeof toToolCall>;
  try {
    call = toToolCall(command, positional, flags);
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    return 1;
  }
  if (!call) {
    console.error(USAGE);
    return command === 'help' ? 0 : 1;
  }

  const services = createHexaCore({ workspaceRoot });
  const registry = createToolRegistry(services);
  if (call.tool === 'run_quality_assurance' && !call.input.stack) {
    call.input.stack = (await services.stackDetector.detectActiveStacks(services.workspace.root))[0] ?? 'node';
  }
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

/** Keeps the preview server running in the foreground (the MCP server starts its own on demand). */
async function servePreviews(workspaceRoot: string | undefined, flags: Record<string, string | boolean>): Promise<number> {
  const port = typeof flags.port === 'string' ? Number(flags.port) : undefined;
  const services = createHexaCore({ workspaceRoot, preview: { port, keepAlive: true }, telemetryLog: false });
  const started = await services.prototypes.preview.start();
  if (started.isFailure) {
    console.error(`Error: ${started.error.message}`);
    return 1;
  }
  const url = await services.prototypes.preview.url();
  console.error(`Serving ${services.workspace.relative(services.prototypes.store.root())} at ${url} (Ctrl+C to stop)`);
  if (flags.open === true && url) openInBrowser(url);
  return new Promise<number>(() => undefined);
}

function openInBrowser(url: string): void {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  import('node:child_process').then(({ spawn }) => spawn(cmd, args as string[], { stdio: 'ignore', detached: true }).unref()).catch(() => undefined);
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
