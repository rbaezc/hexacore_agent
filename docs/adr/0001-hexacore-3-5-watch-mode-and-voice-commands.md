# 1. HexaCore 3.5: watch mode and voice commands

- **Status:** proposed
- **Date:** 2026-11-11
- **Tags:** v3.5, watch, voice, notifications

## Context

After 3.4 (UI prototyping) the user wants HexaCore to be more proactive ("Jarvis-like"): notice breakage without being asked, and be driven by voice. HexaCore is an npm MCP server + CLI; heavy native deps must stay optional (as Playwright is). Audio is personal data.

## Decision

Two new slices. (1) watch: `hexacore watch` watches the workspace, debounces saves, runs toolchain checks (typecheck, test) through the existing QARunnerService, and publishes red/green transitions only (no repeat alerts). Alerts go to pluggable notifiers: terminal, Windows toast, spoken (Windows SAPI), and a persisted watch status that resume_session reports. (2) voice: `hexacore listen` push-to-talk; speech-to-text via local whisper.cpp behind a SpeechToText port (optional install, model downloaded on demand); an intent router maps phrases (EN/ES) to existing services; read-only/safe intents run directly, writes need a spoken confirmation and stay checkpointed; replies spoken via the same TTS notifier. Watch ships first; voice reuses its notifier and can query watch state.

## Alternatives Considered

- Cloud speech-to-text (more accurate, but needs a key, costs, sends audio out)
- Interval-based or git-event-based watching (simpler but slower or misses uncommitted work)
- Voice only via OS dictation (Win+H) with no integration

## Consequences

Easier: proactive feedback and hands-free status/QA, offline and private. Harder: platform-specific notifiers/TTS (Windows first, macOS `say`/Linux fallbacks later), optional native audio capture and a whisper model download, intent matching quality limited to a fixed command set.
