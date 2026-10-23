# Testing Conventions

## Tests Are the Specification
- Write or update the test for a behaviour before (or together with) the implementation.
- When a test fails, fix the implementation. Edit a test only when it is demonstrably wrong, and say so explicitly in the change description.
- Never weaken an assertion, skip a test, or special-case test inputs to get green. HexaCore's auto-fixer refuses to edit test files for this reason.

## What Every Slice Tests
1. The main use case succeeds and persists through the repository port (use the in-memory adapter).
2. Each invariant rejects invalid input (missing id, negative amount…).
3. Adapters get their own focused tests when they contain logic (mapping, queries).

## Test Location per Stack
| Stack | Location | Runner (as invoked by HexaCore) |
|---|---|---|
| node / react / reactnative | `src/features/<slice>/tests/*.test.ts` | `vitest run --reporter=json` or `jest --json` |
| python | `tests/test_<slice>_*.py` | `pytest --junitxml` |
| go | `internal/slices/<slice>/*_test.go` | `go test -json ./...` |
| rust | `#[cfg(test)] mod tests` inside the slice files | `cargo test` |
| dotnet | xUnit project: `tests/<App>.Tests/Features/<Slice>/` | `dotnet test --logger trx` |
| laravel | `tests/Unit/Features/<Slice>/` | `php artisan test --log-junit` / PHPUnit |
| ruby | `spec/features/<slice>/` | `bundle exec rspec --format json` |
| elixir | `test/<app>/<slice>/` | `mix test` |
| flutter | `test/features/<slice>/` | `flutter test --reporter json` |

## Quality Gate
- `run_quality_assurance` with `checks: ["test", "typecheck", "lint"]` must be green before a slice is considered done.
- A check reported as `skipped` was **not verified** (tool missing). Install the tool or state the gap; never treat skipped as passed.

## Test Naming
- Describe behaviour, not implementation: `rejects a missing id`, not `test_create_2`.
- One behaviour per test; arrange–act–assert with no logic in assertions.
