# HexaCore Agent

A governed engineering companion for AI coding agents, exposed as an **MCP server** (and a CLI), for the 11 stacks of the HexaGen suite: Node.js, React, React Native, .NET, Laravel, Rust, Python, Go, Flutter, Ruby and Elixir.

Your AI client plans and writes code. HexaCore makes that work **compliant, verified, reversible and remembered**:

| Need | HexaCore gives the agent |
|---|---|
| Know the rules | Bilingual (EN/ES) rule search over bundled conventions, project rules and ADRs |
| Start right | Vertical slices with ports, adapters, composition root and tests — adapted to the host project |
| Know it works | The stack's own compiler, linter and test runner, with structured failures (file, line, test) |
| Keep the design clean | A whole-repo architecture audit: slice coupling, layer direction, file size |
| Fix safely | Sampling-based auto-fix that never edits tests and rolls back patches that make things worse |
| Undo anything | A checkpoint for every write; exact, all-or-nothing rollback |
| Continue tomorrow | Persisted plans, ADRs, QA history and handoff notes behind `resume_session` |
| Get better with use | A learning loop: resolved failures become lessons, lessons are scored by real test outcomes, proven ones become Claude Code skills |

Generated code is not a template demo: CI scaffolds two slices into a minimal host project for **each of the 11 stacks** and requires the real toolchain (`dotnet`, `cargo`, `mix`, `go`, `flutter`, `pytest`, `phpunit`, `rspec`, `tsc` + `vitest`) to compile it and pass its tests.

## Quick start

```bash
git clone https://github.com/rbaezc/hexacore_agent.git
cd hexacore_agent
npm install
npm run build
```

Register it in Claude Code:

```bash
claude mcp add hexacore-agent -- node /absolute/path/to/hexacore_agent/dist/cli/mcp_launcher.js
```

Or in any MCP client (`mcp.json`):

```json
{
  "mcpServers": {
    "hexacore-agent": {
      "command": "node",
      "args": ["/absolute/path/to/hexacore_agent/dist/cli/mcp_launcher.js"]
    }
  }
}
```

The workspace is taken from the client's MCP roots (or the server's working directory; `HEXACORE_WORKSPACE` overrides both).

## A session

```
resume_session                         → where we left off
/design_feature "Refunds for orders"   → guided design: slices, contract, ADRs, then a plan
define_contract / record_decision      → contract-first API + recorded trade-offs
orchestrate_task (slices: [...])       → rules → scaffold → architecture audit → tests (+ auto-fix)
run_quality_assurance (checks: test, typecheck, lint)
check_architecture
record_handoff                         → context for the next session
record_lesson (episodeId)              → when a check went green: keep what you learned
```

## Learning loop

HexaCore learns from what actually happens in your project, and checks its lessons against the stack's real test results instead of the model's opinion of itself:

1. **Experience**: every check that goes from red to green becomes an *episode* (failure, test, file, line, runs to fix). `run_quality_assurance` asks the model to distill it with `record_lesson`.
2. **Lessons**: markdown in `.hexagen/skills/` (when it applies, what to do, example). They are indexed by `search_knowledge_base`, and you can review, edit and commit them.
3. **Proactive use**: when a check fails, matching lessons come back in the same result. `resume_session` lists the best lessons and the failures that still have no lesson.
4. **Scoring by outcome**: a lesson offered while a check was red is credited when the check goes green, and debited if it stays red for 5 runs. `rate_lesson` adds explicit feedback. Effective lessons rank higher, weak ones are flagged for a rewrite (`updateId` keeps their history) or retired.
5. **Skills**: lessons that have helped at least 3 times, at least 70% of the time, are exported with `export_skills` to `.claude/skills/hexacore-*/SKILL.md`, so Claude Code loads them natively.

## Tools

`resume_session` · `search_knowledge_base` · `execute_scaffolding` · `run_quality_assurance` · `check_architecture` · `orchestrate_task` · `resume_plan` · `list_checkpoints` · `rollback_changes` · `record_decision` · `define_contract` · `record_handoff` · `record_lesson` · `rate_lesson` · `review_lessons` · `export_skills`

Prompts: `design_feature`, `implement_slice`, `fix_failing_checks`. Resources: every rule document and the session briefing.

Full reference: [docs/hexagen_user_manual.md](docs/hexagen_user_manual.md). Design: [docs/architecture_blueprint.md](docs/architecture_blueprint.md). Rules: [docs/rules/](docs/rules/).

## CLI

```bash
npm start -- scaffold go orders --dryRun --workspace ../shop
npm start -- qa go --checks build,lint,test --workspace ../shop
npm start -- arch --workspace ../shop
npm start -- lessons --workspace ../shop
```

JSON on stdout; exit code `2` when checks aren't green.

## Development

```bash
npm test                       # unit + integration (real MCP client over in-memory transport)
npm run build && node scripts/mcp_smoke.mjs   # built server over real stdio
node scripts/e2e_stack.mjs go  # or: all | node,rust,... (needs those toolchains)
npx tsx src/cli/hexacore_cli.ts arch src      # HexaCore audits its own architecture
```

## Project files HexaCore creates

- `.hexagen/state.json` — plans, ADR index, QA history, handoffs (commit it to share with your team).
- `.hexagen/checkpoints/` — rollback journals (add to `.gitignore`).
- `.hexagen/telemetry.log` — JSONL spans (add to `.gitignore`).
- `.hexagen/rules/*.md` — your own rules; they rank above the bundled ones.
- `.hexagen/skills/*.md` and `.hexagen/learning.json` — learned lessons and their track record (commit them to share what the project has learned).
- `.claude/skills/hexacore-*/` — lessons exported as Claude Code skills, when you ask for them.
- `docs/adr/`, `contracts/` — decisions and API contracts, when you ask for them.

## License

MIT
