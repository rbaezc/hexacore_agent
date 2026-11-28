# 3. HexaCore 3.7: watch mode dispatches the qa agent when a check breaks

- **Status:** accepted
- **Date:** 2026-11-25
- **Tags:** v3.7, agents, watch, dispatch, multi-agent, launcher

## Context

Phase 1 (ADR 2, 3.6) lets the user start the dev, qa and e2e roles by hand or lets Claude Code delegate to them, and shows who did what in `hexacore activity`. Phase 2 must start an agent on its own when it is needed: the clearest trigger is watch mode seeing a check go from green to red. Constraints: (1) HexaCore must not run agents itself or need API keys, so the agent is the user's own `claude` CLI, visible in a terminal pane (`claude --agent hexacore-qa "<prompt>"` exists in Claude Code 2.1). (2) The user is on Windows, where Windows Terminal (`wt split-pane`) is available and Herdr (Unix socket, CLI still changing between versions) may not be; tmux users exist too. (3) An agent fixing code makes watch re-run, so a naive trigger can spawn agents in a loop and burn tokens. (4) The spawned agent must know what broke without the user typing it.

## Decision

Add dispatch to watch mode, off by default: `hexacore watch --dispatch qa [--launcher wt|tmux|herdr|print|"<command template>"] [--max-agents 1] [--cooldown 10m]`. (1) Trigger: only `broke` and `baseline_failing` transitions; `still_failing` never dispatches. (2) Hand-off first: before launching, watch records a handoff from 'watch' to 'qa' with the failing checks, files, test names and first error lines, so the agent (and any agent the user starts by hand) gets it through resume_session's handoffsForYou. (3) Launch: a Launcher port in the watch slice with adapters: wt (Windows Terminal split pane in the current window), tmux (split-window), herdr through a template (its CLI differs between versions, so no built-in adapter yet), print (only prints the command to run; the default when no launcher is detected), and a custom template with {agent}, {prompt}, {cwd} placeholders. The command started is `claude --agent hexacore-<role> "<short prompt>"` with HEXACORE_AGENT=<role> in its environment. (4) Guardrails: at most --max-agents dispatched agents in flight (default 1); one in flight per failing check; a dispatch is in flight until that check turns green, the qa agent records a handoff, or --cooldown passes (default 10 min); after a cooldown expires without a fix the same check is not dispatched again until it has been green once; a hard cap of 5 dispatches per watch session. Every dispatch and every skipped dispatch (with its reason) goes to the log and to `hexacore activity`. (5) Only built-in roles can be dispatched (qa in 3.7; e2e later when a UI check fails).

## Alternatives Considered

- Spawn headless `claude -p` in the background (invisible to the user, no way to steer it, burns tokens silently)
- Run the agent through the Agent SDK from HexaCore (needs API keys and separate billing; rejected in ADR 2)
- Herdr only (not reliable on Windows and its CLI is still changing)
- Only a notification saying 'start hexacore-qa' (that is the print launcher; kept as the safe default, but not the whole feature)
- Dispatch on every failing run (loops and token burn while the agent is still fixing)

## Consequences

Easier: save a file that breaks a test and a qa agent opens next to you with the failure already loaded; the dev agent and the qa agent interact visibly through handoffs and the activity feed; works on Windows Terminal, tmux and Herdr, or any terminal through a template. Harder: launching depends on terminal-specific commands that can change (adapters must be small and tested by the command they build, not by opening terminals in CI); a dispatched agent spends the user's tokens, so it stays opt-in with conservative caps; 'in flight' is inferred (green check, handoff or cooldown) because HexaCore does not own the agent process.
