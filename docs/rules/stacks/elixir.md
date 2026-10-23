# Phoenix / Elixir (hexagen)

## Slice Layout
```
lib/<app>/<slice>/
  <slice>.ex                 struct (@enforce_keys) — domain
  repository.ex              behaviour with @callback (port) — domain
  <slice>_context.ex         public API / use cases; repo injected (default from app config)
  in_memory_repository.ex    Agent-backed adapter (@behaviour) — infrastructure
lib/<app>_web/controllers/<slice>_controller.ex   presentation
test/<app>/<slice>/<slice>_context_test.exs
```

## Conventions
- Contexts are the only public API of a slice; other slices call `<Slice>Context`, never its internals.
- Ports are behaviours; adapters declare `@behaviour` and `@impl true`.
- Return tagged tuples (`{:ok, value}` / `{:error, reason}`); no exceptions for expected failures.
- Stateful adapters (Agent/GenServer) run under the application's supervision tree.
- `mix compile --warnings-as-errors` must pass.

## Example
### Good
```elixir
def create(id, repo \\ repository()) when is_binary(id) and id != "" do
```
### Bad
```elixir
Shop.Repo.insert!(%Order{}) # Ecto Repo called from another slice's context
```

## Quality Commands
- test: `mix test`
- build/typecheck: `mix compile --warnings-as-errors`
- lint: `mix format --check-formatted`
