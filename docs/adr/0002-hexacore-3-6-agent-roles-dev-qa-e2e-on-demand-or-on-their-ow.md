# 2. HexaCore 3.6: agent roles (dev, qa, e2e), on demand or on their own

- **Status:** accepted
- **Date:** 2026-11-24
- **Tags:** v3.6, agents, roles, multi-agent, handoff, concurrency

## Context

The user wants separate agents for development, QA and e2e that they can switch on one by one, or that switch on by themselves when needed, and wants to see them interact (as in Herdr or Gentle Shell, which run several coding agents side by side in a terminal). Today HexaCore is an MCP server used by one client agent: orchestrate_task is a fixed pipeline inside that agent, and nothing starts other agents. Terminal multiplexing is already solved by Herdr/Gentle Shell; Claude Code already has subagents (.claude/agents/*.md) that the user can invoke by name and that Claude delegates to on its own when a task matches their description. Several agents mean several HexaCore processes on one workspace (each Claude Code pane starts its own stdio server, and `hexacore watch` is another one), but the state repository only serialises writes inside one process, so concurrent read-modify-write of .hexagen/state.json can lose updates. Subagents of one Claude Code session share its MCP connection, so the server cannot tell which role called it.

## Decision

New `agents` slice, in two phases. Phase 1 (3.6): (1) A role catalogue in the domain: dev (design, scaffold, implement, architecture), qa (run checks, diagnose, fix through the fix flow, lessons), e2e (end-to-end and UI checks against a running app); each role has a description written so Claude Code delegates to it automatically, instructions, and the allow-list of HexaCore tools it may use (qa cannot scaffold, e2e cannot write source). (2) `export_agents` tool and `hexacore agents export [roles]` write .claude/agents/hexacore-<role>.md through a checkpoint, like export_skills; the user starts one by asking for it ("use hexacore-qa") or in its own Herdr pane, and Claude starts it on its own when the description matches. (3) Attribution: an optional `agent` argument on writing and QA tools (role instructions tell the agent to always pass it), with HEXACORE_AGENT as the default for a whole process; checkpoints, QA history, handoffs and telemetry store it. (4) Role handoffs: record_handoff gains `to` (a role); resume_session given `agent` shows the handoffs addressed to it first. (5) A cross-process lock for state writes: a lock file created exclusively next to state.json, with retry and stale-lock recovery, wrapping the existing in-process lock. (6) `hexacore activity`: a live feed of who did what (checkpoints, QA runs, handoffs, rollbacks) for a side pane. Phase 2 (3.7, its own ADR): event triggers, e.g. watch mode turning red starts the qa role in a new pane with the failure loaded, through an adapter for the multiplexer (Herdr first), with a cap on concurrent agents and a cooldown.

## Alternatives Considered

- Build our own terminal multiplexer / agent runner (duplicates Herdr and Gentle Shell, large surface)
- Spawn agents from the MCP server via the Agent SDK (needs API keys and billing outside the user's client, hides the agents from the user)
- Keep one agent and only add role prompts (no automatic delegation, no attribution, no visible interaction)
- Identify roles from MCP clientInfo (subagents share one connection, so all calls look the same)

## Consequences

Easier: start a dev, qa or e2e agent on demand or let Claude Code delegate to it; see which agent wrote, checked or handed off what; run several agents and watch mode on one project without losing state updates; a natural demo with Herdr. Harder: attribution depends on agents passing `agent` (or HEXACORE_AGENT being set) and is advisory, not enforced; tool allow-lists only bind clients that honour subagent tool lists; the cross-process lock adds a little latency and must recover from crashed holders; event-triggered agents (phase 2) depend on a multiplexer adapter and need guardrails against runaway spawning.
