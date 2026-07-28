# Stack-Specific Architectural Conventions

## 1. Phoenix / Elixir (hexagen)
- Strict usage of Elixir Contexts (OTP).
- Test Runner: `mix test`.
- Concurrency management via GenServer / Task Supervisor when applicable.

## 2. .NET / C# Blazor (nethexagen / hexagensharp)
- Strict dependency injection (Scoped / Transient / Singleton).
- Decoupling via `IMediator` interfaces or CQRS.
- Test Runner: `dotnet test`.

## 3. Node.js / TypeScript (nodehexagen)
- Decoupled functional components and custom hooks.
- Strict typing (no `any`).
- Test Runner: `npx vitest run`.

## 4. Laravel / PHP (laravelhexagen)
- Usage of Service Layers and Single-Responsibility Action Classes.
- Eloquent ORM with strict FK constraints and return type hints.
- Test Runner: `php artisan test`.

## 5. Rust (rusthexagen)
- Idiomatic error handling with `Result<T, E>`.
- Zero-cost abstractions and strict memory safety without raw pointers.
- Test Runner: `cargo test`.

## 6. Python / FastAPI (pyhexagen)
- Pydantic schema validation and Type Hints on all service functions.
- Async request handlers.
- Test Runner: `pytest`.

## 7. Go / Golang (gohexagen)
- Clean package boundaries under `internal/slices/`.
- Explicit error checking `if err != nil`.
- Test Runner: `go test ./...`.

## 8. Flutter / Dart (flutterhexagen)
- Feature-first folder structure under `lib/features/`.
- Clean state management.
- Test Runner: `flutter test`.

## 9. Ruby / Rails (rubyhexagen)
- Service Objects and Action Classes under `app/services/`.
- Test Runner: `bundle exec rspec`.
