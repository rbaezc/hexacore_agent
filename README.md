# HexaCore Agent

**Your coding agent writes the code. HexaCore proves it compiles, passes its tests and can be undone.**

[![npm](https://img.shields.io/npm/v/hexacore-agent)](https://www.npmjs.com/package/hexacore-agent)
[![CI](https://github.com/rbaezc/hexacore_agent/actions/workflows/ci.yml/badge.svg)](https://github.com/rbaezc/hexacore_agent/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

![HexaCore Agent demo: scaffold a slice, audit it, watch mode catches a saved bug and its fix, then a voice command undoes the scaffold](docs/demo.gif)

An MCP server (and CLI) for Claude Code, Cursor and any MCP client. It gives the agent your project's rules, runs your stack's real compiler and tests after it writes, takes a checkpoint before every write, and turns each failure it fixes into a lesson — in **11 stacks**: Node.js, React, React Native, .NET, Laravel, Rust, Python, Go, Flutter, Ruby and Elixir.

**Not a template demo.** On every push, CI has HexaCore scaffold two slices into a host project for each of the 11 stacks and requires the real toolchain (`dotnet`, `cargo`, `mix`, `go`, `flutter`, `pytest`, `phpunit`, `rspec`, `tsc` + `vitest`) to compile them and pass their tests.

> **Opinionated:** HexaCore builds and audits [Vertical Slice Architecture](docs/rules/vertical_slice_rules.md) — one folder per feature, ports and adapters inside, no reaching across slices. If that's how you want your codebase to look, it keeps your agent on it.

## What it does

- **Verify** — runs the stack's own compiler, linter and test runner and hands the agent structured failures (file, line, test); audits the whole repo for slice coupling, layer direction and file size; optional auto-fix that never edits tests and rolls back patches that make things worse.
- **Undo** — a checkpoint for every write; exact, all-or-nothing rollback.
- **Remember** — plans, ADRs, QA history and handoff notes behind `resume_session`; your stated preferences and observed habits open every session.
- **Learn** — a failure that goes green becomes a lesson, and a lesson earns credit only when the actual fix matches it. Proven lessons become Claude Code skills and travel to your other projects.
- **Start right** — rule search (English and Spanish) over bundled conventions, your rules and ADRs; scaffolds vertical slices adapted to the host project.
- **Prototype UI** — versioned HTML prototypes with live preview, a `ui` check rendered on phone/desktop in light/dark, then promotion into the project.
- **Work as a team** — dev, qa and e2e agent roles as Claude Code subagents: start one when you want, or let Claude call it when a task matches; they hand work to each other and `hexacore activity` shows who did what.
- **Speak up** — watch mode re-runs checks on save and alerts (terminal, desktop, voice) only when something breaks or is fixed; offline voice commands ("is anything broken?", "undo the last change").

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

## UI prototypes

Design a page or screen before building it, with the same guarantees as code: versioned, checked, reversible and learned from.

1. **Prototype**: `create_prototype` saves the page as a new version in `.hexagen/prototypes/<name>/` (the whole page, or `edits` to the current version) and returns a preview URL on `127.0.0.1` that reloads by itself when a new version is saved.
2. **Check**: `run_quality_assurance` with `checks: ["ui"]` and a `target` (a prototype, an `.html` file, or a `http://localhost` dev server):
   - static rules always run: viewport and title, tokens that resolve to nothing in one theme, missing dark mode, fixed widths wider than a phone, unlabeled images, buttons and inputs, heading order, broken anchors, unpinned CDN scripts;
   - with Playwright in the project (`npm i -D playwright && npx playwright install chromium`), the page is also rendered at 390px and 1280px in light and dark mode: horizontal overflow, text contrast, clipped text, console errors and failed requests, with screenshots in `.hexagen/prototypes/.shots/`. Two of them are attached to the result so the model can look at the page.
3. **Learn**: a `ui` failure that goes green is an episode like a failing test, so lessons about UI mistakes are offered and credited by the actual fix.
4. **Promote**: `promote_prototype` copies the approved version to an `.html` target through a checkpoint and checks it there; for a slice of a React, Flutter… app it returns the design tokens (light and dark), the markup and the steps to port it.

The `/prototype_ui` prompt runs the whole flow, and `search_knowledge_base "ui conventions"` returns the UI rules HexaCore checks against. `HEXACORE_PREVIEW=off` disables the preview server; `HEXACORE_PREVIEW_PORT` changes its port (default 4173).

## Watch mode and voice

```bash
hexacore watch --lang es        # typecheck + tests a moment after each save
hexacore voice setup            # checks ffmpeg + microphone and whisper.cpp, downloads the model
hexacore listen --lang es       # Enter to talk, Enter to stop (or type the command)
```

- **Watch**: a couple of seconds after the last save (`--debounce`), `hexacore watch` runs `typecheck` and `test` (`--checks`) for every stack in the workspace, one run at a time. It interrupts you only when a check changes colour: "The typecheck broke in orders service", "The tests are green again". Alerts go to the terminal, a desktop notification and the system voice (`--notify console,desktop,voice`), in English or Spanish (`--lang`, `HEXACORE_LANG`, or the system locale). Every run is recorded in the QA history and the learning loop, so `resume_session` tells the next session what watch mode saw. Dependencies, build output, dot-directories and simple `.gitignore` entries don't trigger runs.
- **Voice**: `hexacore listen` records with ffmpeg and transcribes with [whisper.cpp](https://github.com/ggml-org/whisper.cpp) on your machine; audio never leaves it. It understands, in Spanish or English: where we left off, run the tests / typecheck / lint / build, is anything broken, list or open prototypes, list checkpoints, undo the last change, help, exit. Undoing is described first and runs only after a spoken "yes"; a rollback that would overwrite later edits is reported, never forced. `--mute` answers in text only.
- **Setup**: ffmpeg on `PATH` (`HEXACORE_FFMPEG`), whisper.cpp's `whisper-cli` in `~/.hexacore/whisper/` or on `PATH` (`HEXACORE_WHISPER`), and a model (`voice setup --model tiny|base|small|medium`, default `base`, ~148 MB; `HEXACORE_WHISPER_MODEL`). `HEXACORE_MIC` picks the microphone.

## Agent roles

```bash
hexacore agents export          # .claude/agents/hexacore-dev.md, hexacore-qa.md, hexacore-e2e.md
hexacore activity               # live feed for a side pane: who wrote, checked, rolled back or handed off what
hexacore watch --dispatch qa    # when a check breaks, open a qa agent in a new pane with the failure loaded
```

- **Roles**: `hexacore-dev` designs, scaffolds and implements; `hexacore-qa` runs the real checks, fixes failures (never by weakening tests) and records lessons; `hexacore-e2e` checks the running app and the UI and reports what breaks. Each gets only the tools of its role: qa can't scaffold, e2e can't edit source.
- **On demand or on their own**: ask for one ("use hexacore-qa to …") or run it in its own terminal pane (Herdr, tmux…); Claude Code also delegates to a role by itself when a task matches its description. `--server` sets the name HexaCore is registered under (default `hexacore-agent`); files you edited by hand are kept unless `--overwrite`.
- **Who did what**: every tool takes an optional `agent`, and `HEXACORE_AGENT` sets it for a whole process (one pane per agent). Checkpoints, rollbacks, QA runs and handoffs record it.
- **Handoffs**: `record_handoff` with `to: "qa"` hands the work over; the qa agent's `resume_session` lists the handoffs addressed to it first.
- **Agents that start themselves**: with `--dispatch qa`, watch mode hands a check that just broke to the qa role (a handoff with the failing tests, files and first error lines) and opens `claude --agent hexacore-qa` in a new pane: Windows Terminal (`--launcher wt`), tmux (`tmux`), any terminal through a template (`--launcher "herdr pane run -- {command}"`), or `print` to only show the command. It is chosen from the terminal you run watch in; outside Windows Terminal and tmux it prints. Guardrails, since the agent spends your tokens: one agent at a time (`--maxAgents`), one per failing check, none while a check stays red, an agent counts as working until its checks pass, it records a handoff or `--cooldown` (10m) passes, and at most 5 per watch session.
- **Several agents, one project**: state, lessons and profile writes are locked across processes, so agents and `hexacore watch` can run side by side without losing updates.

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

`resume_session` · `search_knowledge_base` · `execute_scaffolding` · `run_quality_assurance` · `check_architecture` · `orchestrate_task` · `resume_plan` · `list_checkpoints` · `rollback_changes` · `record_decision` · `define_contract` · `record_handoff` · `record_lesson` · `rate_lesson` · `review_lessons` · `export_skills` · `share_lessons` · `merge_lessons` · `remember_preference` · `forget_preference` · `create_prototype` · `list_prototypes` · `promote_prototype` · `export_agents`

Prompts: `design_feature`, `implement_slice`, `fix_failing_checks`, `prototype_ui`. Resources: every rule document and the session briefing.

Full reference: [docs/hexagen_user_manual.md](docs/hexagen_user_manual.md). Design: [docs/architecture_blueprint.md](docs/architecture_blueprint.md). Rules: [docs/rules/](docs/rules/).

## CLI

```bash
npm start -- scaffold go orders --dryRun --workspace ../shop
npm start -- qa go --checks build,lint,test --workspace ../shop
npm start -- arch --workspace ../shop
npm start -- lessons --workspace ../shop
npm start -- prototype landing ./draft.html --workspace ../shop
npm start -- ui landing --workspace ../shop
npm start -- preview --open --workspace ../shop
npm start -- promote landing docs/index.html --workspace ../shop
npm start -- watch --lang es --workspace ../shop
npm start -- listen --lang es --workspace ../shop
npm start -- agents export --workspace ../shop
npm start -- activity --workspace ../shop
```

JSON on stdout; exit code `2` when checks aren't green.

## Development

```bash
npm test                       # unit + integration (real MCP client over in-memory transport)
npm run build && node scripts/mcp_smoke.mjs   # built server over real stdio
node scripts/e2e_stack.mjs go  # or: all | node,rust,... (needs those toolchains)
npm run e2e:learning           # learning loop on a real Go project (needs Go)
npm run e2e:pack               # npm pack → install → MCP smoke, as users get it
npm run e2e:ui                 # UI prototyping with a real browser (needs: npx playwright install chromium)
npm run e2e:watch              # watch mode + typed voice commands through the built CLI
npx tsx src/cli/hexacore_cli.ts arch src --strict   # self-audit, warnings fail too
```

## Project files HexaCore creates

- `.hexagen/state.json` — plans, ADR index, QA history, handoffs (commit it to share with your team).
- `.hexagen/checkpoints/` — rollback journals (add to `.gitignore`).
- `.hexagen/telemetry.log` — JSONL spans (add to `.gitignore`).
- `.hexagen/rules/*.md` — your own rules; they rank above the bundled ones.
- `.hexagen/skills/*.md` and `.hexagen/learning.json` — learned lessons and their track record (commit them to share what the project has learned).
- `.claude/skills/hexacore-*/` — lessons exported as Claude Code skills, when you ask for them.
- `.claude/agents/hexacore-*.md` — the dev, qa and e2e roles as Claude Code subagents, when you export them (commit them to share the roles).
- `.hexagen/*.lock` — short-lived locks while a state file is being written; a leftover one from a crashed process is taken over automatically.
- `hexacore.json` — optional project config, e.g. `{ "architecture": { "compositionSlices": ["orchestrator"] } }`: slices that exist to coordinate others (orchestrators, API or tool layers) may use their public modules without warnings; reaching their internals is still an error.
- `.hexagen/profile.json` and `~/.hexacore/profile.json` — preferences for this project and for you, and your observed habits.
- `~/.hexacore/lessons/` and `~/.hexacore/learning.json` — your lesson library, shared across projects, when you share lessons (outside the project).
- `.hexagen/prototypes/` — UI prototypes: the current version of each in `<name>/`, every version in `.versions/`, metadata in `.meta/` and screenshots in `.shots/`.
- `.hexagen/ui-shots/` — screenshots of `ui` checks on pages that are not prototypes.
- `~/.hexacore/models/` and `~/.hexacore/whisper/` — the Whisper model and (optionally) whisper.cpp, for voice commands (outside the project).
- `docs/adr/`, `contracts/` — decisions and API contracts, when you ask for them.

## License

MIT
