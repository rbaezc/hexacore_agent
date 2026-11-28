# 4. HexaCore 3.7: project-defined slice layouts and layer rules for check_architecture

- **Status:** accepted
- **Date:** 2026-11-27
- **Tags:** v3.7, architecture, check_architecture, layout, hexacore.json, dotnet, modular-monolith

## Context

check_architecture only recognises the layouts HexaCore generates (src/features/<slice>/<layer>, Features/<Slice>/<Layer>, slices/<slice>/<file>) and a fixed layer model (domain → application → infrastructure/presentation). Real projects that already follow vertical slices often use their own convention. Example: a .NET 10 modular monolith with modules as slices, laid out as Modules/<M>/<M>.<Layer>/ or Modules/<M>/<M>/<Layer>/, layers Contracts/Domain/Features/Infrastructure/Persistence, the rule "another module may only use Contracts", and Features allowed to use Infrastructure. Its own reflection-based ArchitectureTests enforce this after a build. On such a project HexaCore either finds no slices or reports false layer violations, and the fixed 250-line limit flags domain files and generated migrations.

## Decision

hexacore.json `architecture` gains an optional custom layout:
- **layout:** path patterns with {slice}, {layer}, * and **. The first match wins. A repeated {slice} must be the same name. A pattern without {layer} is the slice root, its public module.
- **namespaces:** dotted patterns, e.g. "{slice}.{layer}", that resolve C# `using` directives to slices and layers.
- **layers:** map a layer name (case-insensitive) to `{ public?: boolean, dependsOn?: string[] | ["*"] }`. Other slices may use public layers freely. Using any other layer of another slice is a CROSS_SLICE_COUPLING error. Using another slice's root is a warning, unless the slice is in compositionSlices. Inside a slice, a layer may use itself, the listed layers and layers not declared. "*" or no dependsOn means unrestricted.
- **ignore:** globs left out of the audit, e.g. generated migrations.
- **maxFileLines:** overrides the 250-line limit.

Imports are resolved through the same patterns: relative paths for TS/JS, namespaces for C#. When `layout` is absent nothing changes. An invalid custom config is reported in the result (configErrors) and the audit falls back to the default rules instead of silently passing.

## Alternatives Considered

- Keep the fixed layouts and tell such projects not to use check_architecture (loses the edit-time feedback agents need)
- Hard-code more layouts (modular monolith, clean architecture) as built-ins (each project still varies; endless list)
- Read the project's own architecture tests (stack-specific, needs a build, and that is what the project's tests already do)
- Full rule language like ArchUnit/dependency-cruiser (large surface; patterns + per-layer dependsOn cover the common cases)

## Consequences

Easier: projects with their own vertical-slice convention get edit-time feedback from check_architecture (and watch/QA flows), with their own rules, without moving folders; generated code and line limits stop producing noise. Harder: users must write the patterns (docs need a worked example); namespace resolution only sees `using` directives, not fully qualified names in code; a wrong pattern can make the audit see no slices, so the report lists the slices found and configErrors.
