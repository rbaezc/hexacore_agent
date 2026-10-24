# User Manual & Operating Guide: HexaCore Agent for the HexaGen Suite

---

## 1. End-to-End Developer Workflow

HexaCore Agent is a local MCP server (plus CLI) that your AI client uses as its governed "hands" on any project directory — existing or new. It does not need your project to be running.

1. **One-time setup** — build HexaCore once (`npm install && npm run build`).
2. **Register it in your AI client** — Claude Code, Cursor, VS Code, Antigravity (see §5).
3. **Open any HexaGen project** — HexaCore detects every stack in the workspace (monorepos included, two levels deep) from its manifest files, and takes the workspace root from the client's MCP roots.
4. **Work in a governed loop**:
   - `resume_session` → where the last session stopped.
   - Design: `search_knowledge_base`, `define_contract`, `record_decision`.
   - Build: `execute_scaffolding` (preview with `dryRun`) or `orchestrate_task` for several slices.
   - Verify: `run_quality_assurance` (test, typecheck, lint, build) and `check_architecture`.
   - Learn: when a check goes green, `record_lesson` with the `episodeId` it reports.
   - Close: `record_handoff`.

Every file HexaCore writes is checkpointed; `rollback_changes` undoes it exactly.

---

## 2. One-Time Core Setup Guide

### Prerequisites
- **Node.js** 20 or higher.
- The toolchains of the stacks you work with (HexaCore drives them; it doesn't bundle them).

### Installation
```bash
git clone https://github.com/rbaezc/hexacore_agent.git
cd hexacore_agent
npm install
npm run build
npm test
```

---

## 3. System Overview

- **Governance brain** — bilingual (English/Spanish) BM25 search over the bundled rules (`docs/rules/`), the project's own rules (`.hexagen/rules/*.md`) and its ADRs (`docs/adr/`).
- **Scaffolding** — generates slices adapted to the host project: .NET root namespace and test project, Elixir app name, Dart package, JS test runner and module resolution.
- **Quality assurance** — runs each stack's native tools with machine-readable reporters (JSON, JUnit, TRX, go test -json…) and returns structured failures with file and line.
- **Architecture audit** — cross-slice coupling, layer dependency direction and the 250-line limit, for all 11 stacks.
- **Orchestration** — persisted plans that survive crashes and can be resumed.
- **Change control** — checkpoints for every write; all-or-nothing rollback that refuses to clobber later edits.
- **Memory** — plans, ADR index, QA history and handoff notes in `.hexagen/state.json`.
- **Learning loop** — resolved failures become episodes, the model distills them into lessons (`.hexagen/skills/`), lessons are suggested when a similar check fails and scored by whether the check then goes green; proven ones are exported as Claude Code skills.

---

## 4. HexaGen Suite Support (11 Stacks)

Each stack scaffolds a full slice by default: domain (entity + repository port), application (use cases), infrastructure (in-memory adapter), presentation, a composition root, and tests. Pass `layer` to generate a single layer.

| HexaGen Variant | Stack | Detection File | Test Runner (as invoked) | Generated Slice Root |
| :--- | :--- | :--- | :--- | :--- |
| **hexagen** | Elixir / Phoenix | `mix.exs` | `mix test` | `lib/<app>/<slice>/` + `lib/<app>_web/controllers/` |
| **nodehexagen** | Node.js / TypeScript | `package.json` | `vitest --reporter=json` / `jest --json` | `src/features/<slice>/` |
| **laravelhexagen** | PHP / Laravel | `composer.json` | `php artisan test --log-junit` | `app/Features/<Slice>/` |
| **nethexagen / hexagensharp** | .NET / C# | `*.csproj` / `*.sln` | `dotnet test --logger trx` | `<Project>/Features/<Slice>/` |
| **rusthexagen** | Rust / Axum | `Cargo.toml` | `cargo test` | `src/slices/<slice>/` |
| **pyhexagen** | Python / FastAPI | `pyproject.toml` / `requirements.txt` | `pytest --junitxml` | `app/slices/<slice>/` |
| **reacthexagen** | React | `package.json` (react) | `vitest` / `jest` | `src/features/<slice>/` |
| **gohexagen** | Go | `go.mod` | `go test -json ./...` | `internal/slices/<slice>/` |
| **flutterhexagen** | Flutter / Dart | `pubspec.yaml` | `flutter test --reporter json` | `lib/features/<slice>/` |
| **rubyhexagen** | Ruby / Rails | `Gemfile` | `bundle exec rspec --format json` | `app/features/<slice>/` |
| **reactnativehexagen** | React Native | `package.json` (react-native/expo) | `vitest` / `jest` | `src/features/<slice>/` |

Detailed per-stack rules: `docs/rules/stacks/<stack>.md`.

---

## 5. MCP Integration

HexaCore speaks MCP over stdio.

### Claude Code
```bash
claude mcp add hexacore-agent -- node <path-to-hexacore_agent>/dist/cli/mcp_launcher.js
```

### Generic `mcp.json`
```json
{
  "mcpServers": {
    "hexacore-agent": {
      "command": "node",
      "args": ["<path-to-hexacore_agent>/dist/cli/mcp_launcher.js"]
    }
  }
}
```

- **Workspace**: taken from the client's MCP roots; otherwise the server's working directory. `HEXACORE_WORKSPACE=/path` overrides both.
- **Auto-fix**: enabled automatically when the client supports MCP sampling. Without it, HexaCore returns structured failures and the client model fixes them.

---

## 6. MCP Tool Catalog

| Tool | Purpose |
| :--- | :--- |
| `resume_session` | Briefing: unfinished plans, last QA per check, recent ADRs, last handoff, recent checkpoints, detected stacks. Call first. |
| `search_knowledge_base(query, topK?)` | Rule retrieval across bundled rules, project rules and ADRs (English/Spanish). |
| `execute_scaffolding(stack, sliceName, layer?, targetDir?, dryRun?, overwrite?, includeTests?)` | Generate a slice. Refuses to overwrite unless `overwrite: true`; `dryRun` returns planned files with content. |
| `run_quality_assurance(stack, checks?, scope?, cwd?)` | `test`, `typecheck`, `lint`, `build`. Structured results; missing tools are `skipped` (never `passed`). Streams progress. |
| `check_architecture(path?)` | Audit coupling, layer direction and file size. |
| `orchestrate_task(description, targetStack, slices? \| sliceName, targetDir?, overwrite?, qaChecks?, autoFix?)` | Persisted plan: rules → scaffold each slice → architecture → QA (+ auto-fix). Returns `nextActions`. |
| `resume_plan(planId, autoFix?)` | Continue a plan from its first unfinished step. |
| `list_checkpoints(limit?)` | Recent checkpoints and the files each touched. |
| `rollback_changes(checkpointId, force?)` | Undo a checkpoint; refuses if files changed afterwards unless `force`. |
| `record_decision(title, context, decision, consequences, alternatives?, status?, tags?)` | Write an ADR to `docs/adr/` and index it. |
| `define_contract(sliceName, operations[], …)` | Write `contracts/<slice>.openapi.yaml` (OpenAPI 3.1). |
| `record_handoff(summary, nextSteps?, openQuestions?)` | Leave context for the next session. |
| `record_lesson(title, problem, solution, example?, stack?, tags?, episodeId?, updateId?)` | Save a lesson to `.hexagen/skills/`; `updateId` rewrites one and keeps its history. Returns near-duplicates. |
| `rate_lesson(lessonId, helpful?, retire?)` | Explicit feedback on a suggested lesson, or retire it. |
| `review_lessons(query?, stack?)` | Failures without a lesson, lessons needing review, exportable lessons, best lessons; `query` searches lessons. |
| `export_skills(lessonIds?)` | Write lessons as `.claude/skills/hexacore-<name>/SKILL.md` (default: every proven lesson not yet exported). |

**Prompts** (slash commands in most clients): `design_feature`, `implement_slice`, `fix_failing_checks`.
**Resources**: every rule document (`hexacore://knowledge/...`) and the session briefing (`hexacore://session/briefing`).

---

## 7. CLI

The CLI calls the same tools (same validation) and prints JSON to stdout. Exit codes: `0` ok, `1` error, `2` checks/plan not green.

```bash
npm start -- state --workspace ../my_app
npm start -- rag "reglas de capas en go"
npm start -- scaffold rust payments --dryRun --workspace ../my_app
npm start -- scaffold rust payments --workspace ../my_app
npm start -- qa rust --checks typecheck,test --workspace ../my_app
npm start -- arch --workspace ../my_app
npm start -- orchestrate dotnet orders,invoices --checks build,test --workspace ../my_app
npm start -- resume plan_123 --workspace ../my_app
npm start -- checkpoints --workspace ../my_app
npm start -- rollback cp_123 --workspace ../my_app
npm start -- lessons "namespace error" --stack dotnet --workspace ../my_app
npm start -- export-skills --workspace ../my_app
```

After `npm run build`, the same commands are available as `hexacore <command>`.

---

## 8. Governance & Security Policies

1. **250-line limit** for every source file (generated code is blocked before writing; existing code is reported by `check_architecture`).
2. **Layer direction**: domain → nothing; application → domain; infrastructure → domain/application; presentation → application/domain.
3. **No horizontal coupling** between slices; communicate via `shared/domain` contracts or domain events.
4. **Tests are the specification**: automated fixes never edit test files.
5. **Reversible writes**: every write goes through a checkpoint in `.hexagen/checkpoints/`.
6. **Sandboxed execution**: allowlisted executables only, argv without a shell, path traversal blocked, process-tree kill on timeout.
7. **Circuit breaker** per stack and check: opens on infrastructure failures (spawn errors, timeouts) — never on failing tests.

Recommended `.gitignore` entries for projects using HexaCore:
```
.hexagen/checkpoints/
.hexagen/telemetry.log
```
Commit `.hexagen/state.json` if you want plans, ADR index and handoffs shared with your team, and `.hexagen/skills/` + `.hexagen/learning.json` to share learned lessons and their track record.

### How lessons are scored
- A lesson offered while a check is red is **credited** when that check goes green, and **debited** once if it stays red for 5 runs. `rate_lesson` adds explicit votes.
- Effectiveness = (helped + 1) / (helped + not helped + 2). It multiplies the lesson's search score.
- A lesson with 3 or more negatives and an effectiveness below 35% is flagged **needs_review**: rewrite it (`record_lesson` with `updateId`) or retire it.
- A lesson that is **exportable** has helped at least 3 times with an effectiveness of 70% or more.

---

## 9. Troubleshooting & FAQ

- **A check says `skipped`.** Its tool isn't installed or configured (e.g. no `tsconfig.json`, no ESLint config, PHPStan not in `vendor/`). The `skipReason` says which. Skipped means *not verified*.
- **Tests fail and nothing auto-fixes them.** Your client doesn't support MCP sampling; fix the failures listed in the result (file, line, message) and re-run `run_quality_assurance`.
- **"Refusing to overwrite".** The files exist. Preview with `dryRun: true`, then pass `overwrite: true` if intended — it stays reversible.
- **Rollback reports conflicts.** Someone edited those files after HexaCore wrote them. Nothing was changed. Review, then `force: true` if you really want the old content back.
- **"Circuit breaker is OPEN".** The toolchain itself failed repeatedly (crashes or timeouts). Fix the environment; it retries automatically after 30 seconds.
- **A lesson keeps being suggested but doesn't fit.** `rate_lesson` with `helpful: false`, or `retire: true`. Retired lessons stay on disk but are never offered.
- **Wrong workspace.** Set `HEXACORE_WORKSPACE` in the MCP server configuration, or pass `--workspace` to the CLI.
