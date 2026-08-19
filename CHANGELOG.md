# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
