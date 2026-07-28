# HexaCore Agent: Enterprise Architecture Blueprint

HexaCore Agent is a local, event-orchestrated agentic engineering system governed by strict architecture policies. Its primary goal is to automate the full development lifecycle across all 12 variants of your corporate HexaGen suite (Node.js, .NET/C#, Elixir/Phoenix, Laravel, Rust, Python, Go, Flutter, Ruby, React Native).

```
                    [ USER INTERFACE ]
          (Terminal CLI / IDE / Claude Code / Antigravity)
                               │
                               ▼
                   ┌──────────────────────┐
                   │ HexaCore Orchestrator│ ◄───► [ .hexagen/state.json ]
                   └──────────────────────┘       (State Manifest Persistence)
                               │
              ┌────────────────┴────────────────┐
              ▼                                 ▼
    ┌──────────────────┐               ┌──────────────────┐
    │    Local RAG     │               │ HexaCore-Server  │
    │  (Semantic Search)│               │   (MCP Server)   │
    └──────────────────┘               └──────────────────┘
              │                                 │
              ▼                                 ▼
 ┌─────────────────────────┐       ┌──────────────────────────┐
 │  /docs (Markdown)       │       │ Tooling Catalog          │
 │  - Vertical Slice Rules │       │ - execute_scaffolding    │
 │  - DB Conventions       │       │ - run_quality_assurance  │
 └─────────────────────────┘       └──────────────────────────┘
```

## 1. Tooling & Protocol Layer (Model Context Protocol - MCP)
The operational core is exposed natively via the Model Context Protocol (MCP). This enables compatible AI clients to utilize agent capabilities directly inside your local development environment.
- **HexaCore-Server (MCP)**: A lightweight local server developed in TypeScript/Node.js communicating via standard I/O (stdio).
- **Semantic Tool Isolation (Anti-Tool-Fatigue)**: The server dynamically exposes only the critical toolset required for the active workspace stack (Elixir, .NET, Node, Laravel, Rust, Python, Go, etc.).
- **Key Tools**:
  - `execute_scaffolding(stack, slice_name)`: Creates directory structure and base files respecting Vertical Slice Architecture rules.
  - `run_quality_assurance(stack, scope)`: Runs environment-native test runners under Circuit Breaker protection and parses errors into structured JSON.
  - `resume_session()`: Atomically restores state manifest from `.hexagen/state.json`.
  - `search_knowledge_base(query)`: Executes local BM25/TF-IDF semantic scoring over `/docs`.

## 2. Governance Brain (Local BM25 RAG & Rule Injection)
Prevents AI from generating non-compliant code by maintaining a local retrieval-augmented generation engine over technical specifications in `/docs`.
- **Local BM25 Engine**: Ranks document relevance using term frequency and heading hierarchy multipliers without external API dependencies.
- **Rule Injection**: Dynamically injects matching architectural rules into agent prompts as prioritized context.

## 3. Autonomous Orchestration (AI Agents & QA Loop)
Coordinates Plan-and-Solve strategies, file scaffolding, automated QA execution, and smart code self-healing.
- **HexaCore Orchestrator**: Decomposes high-level requirements into atomic steps.
- **Scaffolding Agent**: Generates boilerplate adhering to strict line count limits (< 250 lines).
- **QA Autonomous Agent Loop**: Executes test runners, parses failure logs, applies automated patches, and re-tests in a closed loop.

## 4. Resilience & Persistent State Management
- **State Manifest (`.hexagen/state.json`)**: Tracks project metadata, case facts, and pipeline step ledgers.
- **Atomic Operations**: Atomic write-to-temp file and OS kernel rename prevents state corruption.