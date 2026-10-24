# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.1.0] - 2026-10-24

### Added

- **Learning loop** (new `learning` slice): HexaCore improves with use, using evidence from real check results.
  - Every QA result is observed. A check that goes from red to green becomes an *episode*, and `run_quality_assurance` asks the model to distill it.
  - `record_lesson` writes a reviewable lesson to `.hexagen/skills/`, linked to its episode. `updateId` rewrites a lesson and keeps its history. Near-duplicates are reported.
  - When a check fails, the relevant lessons come back in the same result. `resume_session` reports the best lessons, failures still to distill and lessons that aren't helping.
  - Offered lessons are credited when the failure resolves and debited if it stays red for 5 runs. `rate_lesson` adds explicit feedback or retires a lesson. Effectiveness ranks lessons in `search_knowledge_base` too.
  - `review_lessons` is the maintenance view, and lesson search.
  - `export_skills` promotes proven lessons to Claude Code skills (`.claude/skills/hexacore-*/SKILL.md`), through a checkpoint.
  - CLI: `lessons [query]`, `export-skills [ids]`.
- `orchestrate_task` results include the learning observation of their QA step.

### Changed

- The text analyzer moved to the shared kernel (`src/shared/domain/text_analyzer.ts`). It is still re-exported by `rag_engine`.
- `RagSearchEngine` accepts a roots function and a per-document `boostProvider`. It also indexes `.hexagen/skills/` as the `lesson` source.

## [3.0.0] - 2026-10-22

### Removed

- **`SmartCodePatcher`**: it "fixed" failing tests by rewriting the assertion text (`expected true to be false` → `true`), i.e. it edited tests to make them pass. Replaced by `LlmCodePatcher` (see below).

### Fixed

- **Circuit breaker opened on red tests**: any non-zero exit counted as a failure, so after three failing test runs (the normal state while fixing code) the fourth was rejected with `exitCode 999` and an empty failure list. The breaker now trips only on infrastructure failures (`spawn_error`, `timeout`), per `stack:check` bucket, and `ProcessExecutionResult.failureKind` distinguishes `exit_code`, `not_found`, `timeout`, `blocked` and `circuit_open`.
- **Scaffolding overwrote existing files silently.** It now refuses (writing nothing) unless `overwrite: true`, supports `dryRun`, and records every write in a checkpoint.
- **Fabricated QA counts**: `totalTests` was `failures + 1` and failures were scraped from lines containing "FAIL"/"Error" (capped at 5). QA now uses each runner's machine-readable output (Vitest/Jest JSON, pytest JUnit, TRX, `go test -json`, Flutter JSON, RSpec JSON, libtest, ExUnit incl. the Elixir 1.20 summary format) and never reports a non-zero exit as passed.
- **Rules and state were resolved against `process.cwd()`**: inside another project the RAG indexed that project's `docs/` and missed HexaCore's rules. Bundled rules now ship with the package; the workspace comes from MCP roots / `HEXACORE_WORKSPACE`.
- Slice names with `-` produced invalid identifiers in most languages; names are now normalized (`user-profile` → `UserProfile`, `user_profile`, Go package `userprofile`), reserved words rejected.
- Generated code hardcoded `App` namespaces/modules; it now follows the host project (.NET RootNamespace and test project, Elixir app, Dart package, JS test runner and module resolution).
- Laravel and Ruby generators used horizontal folders (`app/Actions`, `app/Repositories`…), violating VSA rule 1; they now generate feature folders.
- `npx tsc -p .` was parsed by npx as its own `--package` flag; npx invocations now use `--`.
- Windows: timeouts killed only the `cmd.exe` shim, leaving the runner alive; the whole process tree is now killed.
- Telemetry log rewrote the whole file on every span (O(n²)); it appends.

### Added

- **Structured MCP surface**: zod-validated tool inputs, `isError` on failure, `structuredContent`, progress notifications, stack enums narrowed to the detected stacks, MCP resources (rules, session briefing) and prompts (`design_feature`, `implement_slice`, `fix_failing_checks`).
- **Sampling-based auto-fix** (`LlmCodePatcher`): asks the client's model for search/replace edits; rejects edits to test files, protected directories or ambiguous matches; applies through a checkpoint; the QA loop rolls back a patch that increases failures.
- **`run_quality_assurance` checks**: `test`, `typecheck`, `lint`, `build` per stack, with diagnostics parsed from tsc, MSBuild, rustc, go, mypy, ruff, dart analyze, rubocop, phpstan and mix; missing tools are `skipped` with a reason.
- **`check_architecture`**: workspace audit for cross-slice coupling, layer dependency direction and the 250-line limit across all 11 stacks. HexaCore passes its own audit (enforced in CI).
- **Checkpoints**: `list_checkpoints` / `rollback_changes` with all-or-nothing rollback that refuses to clobber later edits unless forced.
- **Persisted, resumable plans**: `orchestrate_task` takes a multi-slice decomposition, persists every step and returns `nextActions`; `resume_plan` continues from the first unfinished step.
- **Design tools**: `record_decision` (ADRs in `docs/adr/`, indexed by the RAG) and `define_contract` (OpenAPI 3.1 per slice).
- **Session memory**: `resume_session` returns a briefing (unfinished plans, last QA per check, ADRs, handoff, checkpoints); `record_handoff`.
- **Generators**: one file per stack; every slice has a repository port in domain, an in-memory adapter, a composition root and tests; idempotent registrations (Rust `mod.rs`, Python `__init__.py`).
- **Monorepo stack detection** (two levels deep); an empty workspace no longer pretends to be `node`.
- **Bilingual RAG** (accent folding, EN/ES stop words, stemming, synonyms) over bundled rules, `.hexagen/rules/` and ADRs; expanded knowledge base with per-stack rules, testing and design conventions.
- **Verification**: real MCP client integration tests, `scripts/mcp_smoke.mjs` (built server over stdio) and `scripts/e2e_stack.mjs`, which compiles and tests generated slices with each stack's real toolchain (CI matrix of 11 stacks).
- README, `bin` entries (`hexacore`, `hexacore-mcp`), shared composition root for CLI and MCP.

### Changed

- CLI commands route through the same validated tools as MCP, print JSON to stdout (banner on stderr) and exit `2` when checks are not green.
- `IProcessRunner.runCommand(command, args, options)` takes an options object (`cwd`, `bucketKey`, `onOutput`).

## [2.0.1] - 2026-08-19

### Security

- Resolved all 8 `npm audit` findings (4 moderate, 3 high, 1 critical), all in transitive dev/tooling dependencies (`nanoid`, `fast-uri`, `hono` via non-breaking updates; `esbuild`/`vite` via a `vitest` 2.x → 4.x major bump). `npm audit` now reports 0 vulnerabilities. Full test suite (17 files, 35 tests) verified green on `vitest@4.1.11`.

## [2.0.0] - 2026-08-18

### Security

- **Command injection fix**: `run_quality_assurance`'s `scope` parameter used to be concatenated into a shell command string. Process execution now goes through `cross-spawn` with an argv array and no shell, so shell metacharacters in `scope` are inert.
- **Allowlist enforcement**: `SecuritySandboxGuard.validateInvocation` now rejects any base executable not on a fixed allowlist (`mix`, `dotnet`, `npx`, `npm`, `php`, `cargo`, `pytest`, `go`, `flutter`, `bundle`, `node`), in addition to the existing pattern blacklist.
- **Path traversal fix**: `SecuritySandboxGuard.validatePath` had a string-prefix bug that let a sibling directory sharing the root as a prefix pass validation (e.g. `hexacore_agent-evil` against root `hexacore_agent`). It's now boundary-checked correctly, and is actually wired into `ScaffoldingService` (previously unused dead code) to stop a crafted `sliceName` from writing outside the target directory.
- **Sandbox now applies to the MCP server path**: `mcp_launcher.ts` (the entry point used by Claude/Cursor/Antigravity) previously ran commands through a bare, unprotected process runner. It now goes through the same `ResilientProcessRunner` (sandbox + circuit breaker) as the local CLI.

### Added

- **Real timeout on spawned processes**: `NodeProcessRunner` now enforces a configurable timeout (120s default) and kills hung processes, closing a gap where a stuck test runner could hang forever.
- **Per-bucket circuit breaker**: `ResilientProcessRunner` now tracks failure/open state per bucket key (keyed by stack), so a failing `mix test` no longer blocks unrelated `cargo test` calls.
- **Auto-healing wired into `orchestrate_task`**: the orchestrator now runs QA through `QAAutonomousLoop` + `SmartCodePatcher` instead of a single one-shot check, matching the "Auto-Healing" pipeline step the docs already described.
- **250-line policy actually enforced**: `SlicePolicyLinter.lintGeneratedFiles` now runs against every generated file before it's written; scaffolding is blocked (not silently allowed) on a violation.
- **Full 4-layer Vertical Slice scaffolding**: `execute_scaffolding` now generates domain, application, infrastructure, and presentation layers for all 11 stacks, wired together with real dependency injection (handler → repository, presentation → handler) instead of one-line stubs. A new `layer` parameter lets callers request a single layer instead of the full slice.
- **Telemetry is now live**: `TelemetryService` is wired into the orchestrator (a span per pipeline step), and a new `TelemetryLogWriter` persists completed spans as JSONL to `.hexagen/telemetry.log`.
- **State-write locking**: `StateRepository.addFact` / `updateLedgerStep` are now serialized through an in-process async lock, closing a lost-update race when concurrent writes land close together.
- **Corpus-wide BM25 IDF**: the RAG engine's IDF term used to be approximated from term occurrences within a single section. It's now computed from real document frequency across the whole `/docs` corpus, matching the BM25 formula the docs describe.
- CI workflow (`.github/workflows/ci.yml`) running build + full test suite on Ubuntu and Windows.
- `LICENSE` (MIT) at the repo root, matching `package.json`.
- CLI banner and the MCP server's advertised handshake version now read from `package.json` instead of a hardcoded `1.0.0`.

### Fixed

- **`StateRepository` wasn't actually testable**: `saveState` called a hardcoded `AtomicFileWriter` that used `node:fs/promises` directly, bypassing the injected `IFileSystem` entirely. Every existing unit test using a mock filesystem was silently touching the real filesystem instead. Atomic write-via-temp-file-then-rename is now `IFileSystem.writeFileAtomic`, implemented for real by `NodeFileSystem` and properly mockable in tests.

### Changed

- `IProcessRunner.runCommand` signature changed from `(command: string, cwd?)` to `(command: string, args?: string[], cwd?: string, bucketKey?: string)`.
- `IFileSystem` gained a required `writeFileAtomic` method.
- `HexaCoreOrchestrator`'s constructor now takes a `QAAutonomousLoop` (+ optional `CodePatcher`, optional `TelemetryService`) instead of a raw `QARunnerService`.

### Docs

- Corrected "12 stacks" to the actual 11 across the docs site, user manual, and architecture blueprint.
- Updated the scaffolding description and per-stack scaffold-path table to reflect the real 4-layer output.
