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
- HexaCore audits itself in CI (`hexacore arch src`).

## 6. Resilience and Safety
- Process execution without a shell, allowlisted executables, Windows process-tree kill on timeout.
- Circuit breaker per `stack:check` bucket that trips only on infrastructure failures.
- State writes are atomic (temp file + rename) and serialized; checkpoint journals are written before the files they protect.

## 7. Verification Strategy
- Unit and integration tests (including a real MCP client over an in-memory transport).
- `scripts/mcp_smoke.mjs`: the built server over real stdio.
- `scripts/e2e_stack.mjs`: for each of the 11 stacks, scaffold two slices into a minimal host project and require the stack's own compiler, test runner and HexaCore's architecture audit to pass (CI matrix).
