# HexaCore Agent: Architecture Blueprint

HexaCore Agent is a local, governed engineering companion for the 11 stacks of the HexaGen suite. An AI client (Claude Code, Cursor, VS Code, Antigravity) plans and writes code; HexaCore supplies the rules, generates compliant slices, verifies with the real toolchains, audits the architecture, keeps every write reversible and remembers context across sessions.

```
              AI client (plans, writes code, answers sampling requests)
                                 │  MCP over stdio (tools · resources · prompts)
                                 ▼
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ mcp_server: zod-validated tools, isError, structuredContent, progress,   │
 │             roots → workspace, sampling → LlmClient                      │
 ├──────────────┬──────────────┬──────────────┬─────────────┬───────────────┤
 │ orchestrator │ scaffolding  │ quality_     │ architecture│ design        │
 │ persisted    │ 11 stack     │ assurance    │ coupling,   │ ADRs,         │
 │ plans        │ generators   │ reporters,   │ layers,     │ OpenAPI       │
 │              │ + profiles   │ auto-fix     │ file size   │ contracts     │
 ├──────────────┴──────────────┴──────────────┴─────────────┴───────────────┤
 │ rag_engine (bundled rules + .hexagen/rules + docs/adr)                   │
 │ state_management (.hexagen/state.json: plans, ADRs, QA history, handoffs)│
 ├──────────────────────────────────────────────────────────────────────────┤
 │ shared kernel: Result, stack types, slice names, policy, workspace,      │
 │ change journal (checkpoints), sandbox + circuit breaker, file system     │
 └──────────────────────────────────────────────────────────────────────────┘
```

## 1. Protocol Layer (MCP)
- **Tools** are defined with zod schemas; arguments are validated before any handler runs, and failures come back as `isError: true` with a precise message. Successful results carry `structuredContent`.
- **Stack-aware catalog**: stack enums in tool schemas are narrowed to the stacks detected in the workspace.
- **Roots**: the workspace root is taken from the client's MCP roots (or `HEXACORE_WORKSPACE`), so rules, state and checkpoints always refer to the user's project.
- **Sampling**: when the client supports it, HexaCore asks the client's model for code fixes; it never holds an API key.
- **Resources and prompts** expose the rule corpus, the session briefing and guided workflows.

## 2. Governance Brain (RAG)
- BM25 with corpus-wide IDF over markdown sections, heading boost, parent-heading context.
- Bilingual analyzer: accent folding, English/Spanish stop words, light stemming and a domain synonym map.
- Sources ranked project > decisions > bundled, so local conventions override defaults.

## 3. Scaffolding
- One generator per stack producing a `SliceBlueprint`: four layers, a composition root, tests and idempotent registrations (e.g. `pub mod x;` in `src/slices/mod.rs`).
- `ProjectProfileDetector` reads host manifests (csproj, mix.exs, pubspec.yaml, package.json, tsconfig.json) so generated code matches the project.
- Every file passes the 250-line policy before writing; existing files are never overwritten without consent; all writes go through a checkpoint.

## 4. Quality Assurance
- `CheckCatalog` picks the machine-readable invocation per stack and check, with fallbacks (`pytest` → `python -m pytest`).
- Parsers: Jest/Vitest JSON, JUnit (pytest/PHPUnit), TRX, `go test -json`, Flutter JSON, RSpec JSON, libtest and ExUnit text, plus diagnostics for tsc, MSBuild, rustc, go, mypy, ruff, dart analyze, rubocop, phpstan and mix.
- Invariant: a non-zero exit is never reported as passed; a missing tool is `skipped`, never `passed`.
- Auto-fix loop: test → model-proposed search/replace patch (implementation files only) → re-test; a patch that increases failures is rolled back.

## 5. Architecture Audit
- Classifies each file into slice and role (domain, application, infrastructure, presentation, module, test) per stack layout, extracts imports per language (TS/JS, Dart, Python, Rust, Go, C#, PHP, Ruby, Elixir) and enforces the dependency matrix.
- Composition slices declared in `hexacore.json` (`architecture.compositionSlices`) may import other slices' public modules; internal imports stay errors. `--strict` fails on warnings too.
- HexaCore audits itself in CI (`hexacore arch src --strict`), with `orchestrator` and `mcp_server` as its composition slices.

## 6. Learning Loop
- **Sensor**: every QA result (tool calls and orchestrated plans) is observed. A red check opens a failure keyed by stack, check and directory, with a masked signature (paths, numbers and values removed) so the same problem is recognized again. Red → green closes it as an *episode*.
- **Memory**: lessons are markdown in `.hexagen/skills/`, indexed by the RAG engine as a `lesson` source. The index and statistics live in `.hexagen/learning.json`, apart from the project manifest.
- **Retrieval**: when a check fails, the lessons relevant to that stack are returned with the result. The `learning` slice reaches the search engine through a port (`LessonSearch`) injected by the composition root, not through a direct dependency.
- **Credit assignment**: the project's text files are snapshotted when a failure is first seen red, and diffed when it goes green (`WorkspaceSnapshots`, no VCS needed). `FixAttributor` credits only the offered lessons whose terms the changed lines and files share; a green without changes credits nobody; without a red snapshot it falls back to crediting every offered lesson. Lessons that stay red for 5 runs are debited, and explicit ratings add to that. A Laplace-smoothed effectiveness multiplies search scores, flags weak lessons for review and gates promotion.
- **Promotion**: proven lessons are exported as Claude Code skills through a checkpoint, so they are reversible.
- **Library**: proven lessons are shared to the user's library (`~/.hexacore/`), a second `LearningRepository` + `LessonFinder` pair. Project lessons are offered first and the library fills the remaining slots, skipping the library copies of the project's own lessons. Outcomes in any project update the library stats.

- **Maintenance**: search weight decays for lessons idle more than 60 days (to 0.6 at a year). Near-duplicates (Jaccard ≥ 0.5 over title + problem) are reported in pairs, and `merge_lessons` folds them, moving evidence, episodes and open-failure offers to the survivor.

## 7. User Model
- **Sensor**: the tool registry notifies an observer after every validated call. `user_profile` folds the calls that say something about habits into counters in `~/.hexacore/profile.json`: stacks, QA check sets, scaffold previews and writes, writes and rollbacks.
- **Model**: habits are derived from the counters only above evidence thresholds. Stated preferences are remembered by the client model (`remember_preference`), in user or project scope.
- **Use**: preferences and habits open the `resume_session` briefing, so the model adapts before acting. Local files only; credential-like text is refused; everything can be forgotten.

## 8. UI Prototyping
- **Slice** `prototyping`: `PrototypeStore` (each version is one checkpoint holding the current files, an archive and the metadata, so a rollback is complete), `PreviewServer` (`node:http` on 127.0.0.1, reads through `IFileSystem`, Host-checked, live reload by polling the current version), `UiAuditor` (static rules over the source, then a `BrowserDriver`), `PrototypePromoter`.
- **The `ui` check is a QA check**: `QARunnerService` delegates it to a `UiCheckPort` that the composition root implements with the auditor, mapping findings onto QA's vocabulary (errors → failures, warnings → warnings, rule + viewport + theme → test name). Learning, snapshots and diff attribution work unchanged; the check runs in the audited page's directory, so the diff is that page's change.
- **Browser**: Playwright is loaded from the project (or next to HexaCore) at call time; it is not a dependency. A probe script in the page reports overflow, contrast and clipping; console errors and failed requests come from page events.
- **Images**: results carry screenshots on a non-enumerable symbol (`attachImages`), which the MCP layer turns into image content after the JSON text, so the image data never bloats the text the model reads.

## 9. Watch Mode and Voice
- **Slice** `watch`: `WatchService` debounces changes from a `FileWatcher` (recursive `fs.watch`), runs one check pass at a time (changes during a run cause exactly one more), and compares statuses per `stack:check` (`compareRuns`). Only colour changes (`broke`, `fixed`, and a failing first run) reach the interrupting `Notifier`s (desktop, voice); everything goes to the terminal. Skipped checks never change a known status.
- **Notifiers** spawn the platform's own tools without a shell (PowerShell WinRT toast and System.Speech on Windows, `osascript`/`say` on macOS, `notify-send`/`spd-say` on Linux). Alert text travels in environment variables or argv, never inside a script.
- **Slice** `voice`: `VoiceSession` maps sentences to intents (`parseIntent`, Spanish and English, accent- and punctuation-insensitive) and intents to tool calls through a `ToolCaller` port. Reads run at once; `rollback_last` is described and waits for a spoken yes (anything else cancels), and a refused rollback is reported, never forced. `FfmpegRecorder` captures 16 kHz mono WAV (no native modules) and `WhisperTranscriber` runs whisper.cpp offline.
- **Composition** happens in `src/cli`: `watch_command.ts` adapts `QARunnerService` to the watcher's `CheckRunner` and records each run (`source: 'watch'`) plus the learning loop, exactly like `run_quality_assurance`; `voice_command.ts` hands the voice session the MCP tool registry and the watch slice's speech notifier. Neither slice imports another.

## 10. Resilience and Safety
- Process execution without a shell, allowlisted executables, Windows process-tree kill on timeout.
- Circuit breaker per `stack:check` bucket that trips only on infrastructure failures.
- State writes are atomic (temp file + rename) and serialized; checkpoint journals are written before the files they protect.

## 11. Verification Strategy
- Unit and integration tests (including a real MCP client over an in-memory transport).
- `scripts/mcp_smoke.mjs`: the built server over real stdio.
- `scripts/e2e_stack.mjs`: for each of the 11 stacks, scaffold two slices into a minimal host project and require the stack's own compiler, test runner and HexaCore's architecture audit to pass (CI matrix).
- `scripts/pack_smoke.mjs`: `npm pack`, install the tarball into an empty project, run the MCP smoke test against the installed launcher and the CLI against its bundled rules; also checks `server.json` (MCP registry) matches `package.json` (CI, Linux and Windows).
- `scripts/e2e_learning.mjs`: break and fix a generated Go slice with the real `go test`, and require the episode, the lesson, diff-backed credit, skill export and the library to work across two projects (CI).
- `scripts/e2e_ui.mjs`: with Chromium and the real preview server, a prototype that only breaks on a phone must be caught by the rendered check, fixed, turned into a lesson that is offered and credited on a second prototype, and promoted and re-checked in place (CI).
