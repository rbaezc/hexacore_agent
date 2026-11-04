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
| Get better with use | A learning loop: resolved failures become lessons, lessons are credited only when the actual fix matches them, proven ones become Claude Code skills and travel to your other projects |
| Adapt to you | A user model across sessions: preferences you state, plus habits observed from how you actually work, at the top of every briefing |

Generated code is not a template demo: CI scaffolds two slices into a minimal host project for **each of the 11 stacks** and requires the real toolchain (`dotnet`, `cargo`, `mix`, `go`, `flutter`, `pytest`, `phpunit`, `rspec`, `tsc` + `vitest`) to compile it and pass its tests.

## Quick start

Register it in Claude Code (Node 20+):

```bash
claude mcp add hexacore-agent -- npx -y hexacore-agent
```

Or in any MCP client (`mcp.json`):

```json
{
  "mcpServers": {
    "hexacore-agent": {
      "command": "npx",
      "args": ["-y", "hexacore-agent"]
    }
  }
}
```

The CLI is `npx -p hexacore-agent hexacore <command>` (or `npm install -g hexacore-agent`, then `hexacore <command>`).

From source:

```bash
git clone https://github.com/rbaezc/hexacore_agent.git
cd hexacore_agent
npm install
npm run build
claude mcp add hexacore-agent -- node /absolute/path/to/hexacore_agent/dist/cli/mcp_launcher.js
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

## How HexaCore adapts to you

- **What you say**: when you state a lasting preference ("always show the plan before writing", "name Go packages in singular"), the model calls `remember_preference`. `scope: user` (default) follows you to every project; `scope: project` applies to one.
- **What you do**: HexaCore counts how you use it (stacks, the checks you run, whether you preview scaffolding, how often you roll back its changes) and, with enough evidence, derives habits such as "usually verifies with [test, typecheck]".
- Both open every `resume_session` briefing, so each session starts adapted to you.
- Local files only (`~/.hexacore/profile.json`, `.hexagen/profile.json`). Credential-like text is refused. `forget_preference` removes one preference, the observed habits (`observed: true`) or everything (`all: true`). `HEXACORE_PROFILE=off` disables the user profile.

## Learning loop

HexaCore learns from what actually happens in your project, and checks its lessons against the stack's real test results instead of the model's opinion of itself:

1. **Experience**: every check that goes from red to green becomes an *episode* (failure, test, file, line, runs to fix). `run_quality_assurance` asks the model to distill it with `record_lesson`.
2. **Lessons**: markdown in `.hexagen/skills/` (when it applies, what to do, example). They are indexed by `search_knowledge_base`, and you can review, edit and commit them.
3. **Proactive use**: when a check fails, matching lessons come back in the same result. `resume_session` lists the best lessons and the failures that still have no lesson.
4. **Scoring by evidence**: HexaCore snapshots the project when a check turns red and compares it with the project when it turns green. A lesson offered meanwhile is credited only if the fix resembles it (its terms appear in the changed lines or files); a check that goes green without any change credits nobody. Lessons that stay red for 5 runs are debited, and `rate_lesson` adds explicit feedback. Effective lessons rank higher, weak ones are flagged for a rewrite (`updateId` keeps their history) or retired.
5. **Skills**: lessons that have helped at least 3 times, at least 70% of the time, are exported with `export_skills` to `.claude/skills/hexacore-*/SKILL.md`, so Claude Code loads them natively.
6. **Maintenance**: lessons nobody has used for months lose weight in search (down to 60% after a year) and are listed as stale; near-duplicates are listed in pairs and `merge_lessons` folds them into one, keeping their evidence.
7. **Your other projects**: `share_lessons` copies proven lessons to your lesson library (`~/.hexacore/`, or `$HEXACORE_HOME`). Projects with the same stack get them as suggestions after their own lessons (`library:<id>`), and their outcomes keep scoring them. `HEXACORE_LIBRARY=off` disables the library.

## Tools

`resume_session` · `search_knowledge_base` · `execute_scaffolding` · `run_quality_assurance` · `check_architecture` · `orchestrate_task` · `resume_plan` · `list_checkpoints` · `rollback_changes` · `record_decision` · `define_contract` · `record_handoff` · `record_lesson` · `rate_lesson` · `review_lessons` · `export_skills` · `share_lessons` · `merge_lessons` · `remember_preference` · `forget_preference`

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
npm run e2e:learning           # learning loop on a real Go project (needs Go)
npm run e2e:pack               # npm pack → install → MCP smoke, as users get it
npx tsx src/cli/hexacore_cli.ts arch src --strict   # self-audit, warnings fail too
```

## Project files HexaCore creates

- `.hexagen/state.json` — plans, ADR index, QA history, handoffs (commit it to share with your team).
- `.hexagen/checkpoints/` — rollback journals (add to `.gitignore`).
- `.hexagen/telemetry.log` — JSONL spans (add to `.gitignore`).
- `.hexagen/rules/*.md` — your own rules; they rank above the bundled ones.
- `.hexagen/skills/*.md` and `.hexagen/learning.json` — learned lessons and their track record (commit them to share what the project has learned).
- `.claude/skills/hexacore-*/` — lessons exported as Claude Code skills, when you ask for them.
- `hexacore.json` — optional project config, e.g. `{ "architecture": { "compositionSlices": ["orchestrator"] } }`: slices that exist to coordinate others (orchestrators, API or tool layers) may use their public modules without warnings; reaching their internals is still an error.
- `.hexagen/profile.json` and `~/.hexacore/profile.json` — preferences for this project and for you, and your observed habits.
- `~/.hexacore/lessons/` and `~/.hexacore/learning.json` — your lesson library, shared across projects, when you share lessons (outside the project).
- `docs/adr/`, `contracts/` — decisions and API contracts, when you ask for them.

## License

MIT
