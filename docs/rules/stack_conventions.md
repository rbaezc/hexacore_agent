# Stack-Specific Architectural Conventions

Each HexaGen stack has a detailed rule file in `docs/rules/stacks/` with the exact slice layout HexaCore generates, conventions, good/bad examples and the quality commands HexaCore runs.

| Stack | Variant | Rules | Test runner |
|---|---|---|---|
| Phoenix / Elixir | hexagen | stacks/elixir.md | `mix test` |
| .NET / C# | nethexagen / hexagensharp | stacks/dotnet.md | `dotnet test` |
| Node.js / TypeScript | nodehexagen | stacks/node.md | `npx vitest run` |
| Laravel / PHP | laravelhexagen | stacks/laravel.md | `php artisan test` |
| Rust | rusthexagen | stacks/rust.md | `cargo test` |
| Python / FastAPI | pyhexagen | stacks/python.md | `pytest` |
| Go | gohexagen | stacks/go.md | `go test ./...` |
| Flutter / Dart | flutterhexagen | stacks/flutter.md | `flutter test` |
| Ruby / Rails | rubyhexagen | stacks/ruby.md | `bundle exec rspec` |
| React | reacthexagen | stacks/react.md | `npx vitest run` |
| React Native | rnhexagen | stacks/reactnative.md | `npx vitest run` / `npx jest` |

## Common to All Stacks
- Vertical slices with four layers plus a composition root (see vertical_slice_rules.md).
- Repository ports in the domain layer; in-memory adapter first, real adapter later behind the same port.
- Every slice ships with tests (see testing_conventions.md).
