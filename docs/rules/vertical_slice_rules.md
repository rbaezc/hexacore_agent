# Vertical Slice Architecture (VSA) Rules

## Core Principles
1. **Feature Isolation**: Each feature (slice) lives in its own self-contained directory with its domain model, use cases, adapters, entry points and tests.
2. **Zero Horizontal Coupling**: A slice never imports the internals (domain, application, infrastructure, presentation) of another slice.
3. **Explicit Contracts**: Cross-slice communication goes exclusively through domain events or interfaces in `shared/domain`. Importing another slice's public module is tolerated only for composition code and is reported as a warning.
4. **File Line Limit**: No source file exceeds **250 lines** (SRP and high cohesion). Split by responsibility, never by arbitrary chunks.
5. **SOLID**: SRP, OCP, LSP, ISP and especially **DIP** — the application layer depends on ports, never on concrete adapters.

## Layers Inside a Slice
| Layer | Contains | May depend on |
|---|---|---|
| domain | Entities, value objects, invariants, repository **ports** (interfaces/traits/behaviours/protocols) | domain only |
| application | Use cases / handlers / services orchestrating the domain | domain, application |
| infrastructure | Adapters implementing ports: persistence, HTTP clients, queues | domain, application, infrastructure |
| presentation | Controllers, routes, handlers, widgets, screens | domain, application, presentation, module |
| module | Composition root: wires concrete adapters into use cases (DI registration, router, provider) | anything in the slice |
| tests | Specification of the slice's behaviour | anything |

The domain layer must not know that a database, a web framework or a UI exists.

## Composition Root
Every slice has exactly one place that knows the concrete adapters: `index.ts`, `mod.rs`, `module.py`, `module.go`, `<Slice>Module.cs`, `<Slice>ServiceProvider.php`, `composition.rb`, `<slice>_module.dart`, or application config in Elixir. Presentation receives already-wired use cases.

### Good
```ts
// src/features/orders/index.ts — composition root
const handler = new OrdersHandler(new InMemoryOrdersRepository());
```

### Bad
```ts
// src/features/orders/application/orders_handler.ts
import { PostgresOrdersRepository } from '../infrastructure/postgres_repository.js'; // application → infrastructure
```

## Cross-Slice Communication
- Publish a domain event (`OrderPlaced`) from the producing slice; consumers subscribe in their own module.
- Shared vocabulary (ids, money, the event contracts themselves) lives in `shared/domain`.
- Never reach into `../../billing/infrastructure/...` from `orders`. The architecture audit flags this as `CROSS_SLICE_COUPLING` (error).

## Verification
- `check_architecture` audits the whole workspace: `CROSS_SLICE_COUPLING`, `LAYER_DEPENDENCY_VIOLATION`, `MAX_LINE_COUNT_EXCEEDED`.
- Run it after every change set; zero errors is the merge bar. Warnings must be justified in an ADR.
