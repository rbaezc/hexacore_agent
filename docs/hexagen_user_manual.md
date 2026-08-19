# User Manual & Operating Guide: HexaCore Agent for the HexaGen Suite

---

## 1. End-to-End Developer Workflow: How It Works

Do you need your target HexaGen project running before starting? **No!** HexaCore Agent acts as an autonomous local engine that interfaces with any project directory (existing or new).

### The Complete Lifecycle:

1. **Step 1 — One-Time Server Setup**:
   You build HexaCore Agent only once on your machine (`<path-to-hexacore_agent>`). This prepares the local Model Context Protocol (MCP) server executable.

2. **Step 2 — IDE / AI Client Registration**:
   Configure your `mcp.json` pointing to HexaCore Agent. This connects the agent's tools directly to your AI chat interface (Antigravity, Claude Code, Cursor, VS Code).

3. **Step 3 — Open Any HexaGen Project Workspace**:
   Open your target project folder (e.g., `my_rust_backend` with `Cargo.toml` or `my_elixir_app` with `mix.exs`). HexaCore automatically senses the **Project Detection File**. If the directory is empty, HexaCore can scaffold the base project for you!

4. **Step 4 — Autonomous Execution & QA Loop**:
   When you ask to build a feature (e.g., "Create a payments slice"), HexaCore extracts rules from `/docs`, generates VSA files (< 250 lines), executes test runners (`cargo test`, `mix test`, `dotnet test`), and auto-fixes failing code in a closed loop.

---

## 2. One-Time Core Setup Guide

### Prerequisites
- **Node.js**: v20.0.0 or higher
- **npm / npx**: v10.0.0 or higher

### Installation Commands
```bash
# 1. Clone & navigate to your hexacore_agent directory
git clone https://github.com/rbaezc/hexacore_agent.git
cd hexacore_agent

# 2. Install dependencies
npm install

# 3. Build TypeScript project
npm run build

# 4. Run automated test suite
npm test
```

---

## 3. System Overview & Core Architecture

HexaCore Agent is a local, event-orchestrated agentic engineering system operating at Principal Platform Architecture level, governed by strict architectural policies.

It automates the complete software development lifecycle (Plan-and-Solve, Scaffolding, Rule RAG, Autonomous QA, and Code Self-Healing) across all **11 variants of the corporate HexaGen suite**.

---

## 4. Complete HexaGen Suite Support (11 Stacks)

HexaCore Agent automatically detects the active technology stack in the workspace root and dynamically exposes only the required tool catalog (Anti-Tool-Fatigue pattern):

Each stack scaffolds a full 4-layer slice by default: **domain** (entity/schema), **application** (handler/service, injected with the repository), **infrastructure** (repository), and **presentation** (controller/route/widget, injected with the handler). Pass `layer` to `execute_scaffolding` to generate only one of them.

| HexaGen Variant | Technology Stack | Project Detection File | Automated Test Runner | Generated Slice Root |
| :--- | :--- | :--- | :--- | :--- |
| **hexagen** | Elixir / Phoenix | `mix.exs` | `mix test` | `lib/app/<slice>/` (+ `lib/app_web/controllers/<slice>_controller.ex`) |
| **nodehexagen** | Node.js / TypeScript | `package.json` | `npx vitest run` | `src/features/<slice>/{domain,application,infrastructure,presentation}/` |
| **laravelhexagen** | PHP / Laravel | `composer.json` | `php artisan test` | `app/DataTransferObjects/`, `app/Actions/<Slice>/`, `app/Repositories/`, `app/Http/Controllers/` |
| **nethexagen / hexagensharp** | .NET / C# (Blazor) | `*.csproj` / `*.sln` | `dotnet test` | `Features/<Slice>/{<Slice>Entity,<Slice>Handler,<Slice>Repository,<Slice>Controller}.cs` |
| **rusthexagen** | Rust / Axum | `Cargo.toml` | `cargo test` | `src/slices/<slice>/{domain,service,repository,handler,mod}.rs` |
| **pyhexagen** | Python / FastAPI | `pyproject.toml` | `pytest` | `app/slices/<slice>/{domain,service,repository,router}.py` |
| **reacthexagen** | React / Vite | `package.json` (react) | `npm test` | `src/features/<slice>/{domain,application,infrastructure,presentation}/` |
| **gohexagen** | Go / Golang | `go.mod` | `go test ./...` | `internal/slices/<slice>/{domain,service,repository,handler}.go` |
| **flutterhexagen** | Flutter / Dart | `pubspec.yaml` | `flutter test` | `lib/features/<slice>/{domain,application,infrastructure,presentation}/` |
| **rubyhexagen** | Ruby / Rails | `Gemfile` | `bundle exec rspec` | `app/domain/`, `app/services/`, `app/repositories/`, `app/controllers/` |
| **reactnativehexagen** | React Native / Mobile | `package.json` (rn) | `npm test` | `src/features/<slice>/{domain,application,infrastructure,presentation}/` |

---

## 5. Configuration & MCP Integration

HexaCore Server connects natively via the **Model Context Protocol (MCP)** over `stdio` to AI clients such as Antigravity, Claude Code, Cursor, or VS Code.

### Configuration Specification (`mcp.json`):
```json
{
  "mcpServers": {
    "hexacore-agent": {
      "command": "npx",
      "args": ["tsx", "<path-to-hexacore_agent>/src/cli/mcp_launcher.ts"]
    }
  }
}
```

---

## 6. Exposed MCP Tool Catalog Reference

### 1. `resume_session`
- **Description**: Atomically loads transactional memory and state manifest from `.hexagen/state.json`.

### 2. `search_knowledge_base`
- **Parameters**: `query` (string).
- **Description**: Executes local BM25/TF-IDF semantic scoring over `/docs` and extracts exact architecture rules.

### 3. `execute_scaffolding`
- **Parameters**: `stack` (enum of 11 stacks), `sliceName` (string), `layer` (optional: `domain` | `application` | `infrastructure` | `presentation` | `full`, default `full`).
- **Description**: Generates a complete Vertical Slice — domain entity, application handler/service, infrastructure repository, and presentation controller/route — wired together with real dependency injection (handler depends on repository, presentation depends on handler) and idiomatic per-stack patterns (CQRS for .NET, Actions for Laravel, Contexts for Elixir, hooks for React, etc.), respecting file line limits (< 250 lines) and cross-slice decoupling. Pass `layer` to generate a single layer instead of the full slice.

### 4. `run_quality_assurance`
- **Parameters**: `stack` (enum of 11 stacks), `scope` (optional).
- **Description**: Launches environment-native unit test suites under Circuit Breaker protection and parses failures into structured JSON.

### 5. `orchestrate_task`
- **Parameters**: `description`, `targetStack`, `sliceName`.
- **Description**: Executes full autonomous Plan-and-Solve agent pipeline (RAG -> Scaffolding -> QA -> Self-Healing).

---

## 7. Interactive CLI Workbench Usage

Developers can also operate the platform directly from the terminal:

```bash
# Query transactional state manifest
npm start state

# Perform local BM25 semantic rule search
npm start rag "database foreign key constraints"

# Scaffold a Vertical Slice for any HexaGen stack
npm start scaffold rust payments
npm start scaffold elixir auth
npm start scaffold python order

# Run complete Plan-and-Solve autonomous pipeline
npm start orchestrate billing dotnet
```

---

## 8. Governance & Security Policies

1. **Strict Line Count Limit (< 250 Lines)**: No generated or maintained source code file may exceed **250 lines of code**.
2. **Foreign Key Constraints (FK Constraints)**: Mandatory usage across all relational database migrations.
3. **Process Resilience**: All child processes operate under automatic **Circuit Breaker** protection (`CLOSED`, `OPEN`, `HALF_OPEN`).
4. **Security Sandbox Guard**: Path traversal protection and shell sanitization against destructive commands.

---

## 9. Troubleshooting & FAQ

- **What happens if a test fails during QA?**
  The QA Autonomous Loop intercepts the log, triggers `SmartCodePatcher`, applies fixes to source files, and re-tests automatically.
- **How does State Recovery work?**
  When starting a new chat session, `resume_session` reads `.hexagen/state.json` and restores project facts and pipeline ledgers into prompt context.
