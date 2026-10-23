# .NET / C# (nethexagen / hexagensharp)

## Slice Layout
```
<Project>/Features/<Slice>/
  Domain/<Slice>Entity.cs                   entity + I<Slice>Repository (port)
  Application/Create<Slice>Handler.cs       command record + handler
  Infrastructure/InMemory<Slice>Repository.cs
  Presentation/<Slice>Controller.cs         [ApiController]
  <Slice>Module.cs                          services.Add<Slice>Feature(): DI composition root
tests/<App>.Tests/Features/<Slice>/Create<Slice>HandlerTests.cs   (xUnit)
```
Namespaces follow folders: `<RootNamespace>.Features.<Slice>.<Layer>`.

## Conventions
- Strict dependency injection (Scoped handlers, Singleton in-memory stores, Scoped DbContext adapters).
- CQRS style: one handler per command or query; handlers never call each other.
- Nullable reference types enabled; no `!` to silence warnings.
- Keep the main project and the test project in separate folders so SDK globbing doesn't compile tests twice.

## Example
### Good
```csharp
public CreateOrdersHandler(IOrdersRepository repository) => _repository = repository;
```
### Bad
```csharp
var repo = new SqlOrdersRepository(); // `new` of an adapter inside a handler
```

## Quality Commands
- test: `dotnet test --logger trx`
- build/typecheck: `dotnet build`
- lint: `dotnet format --verify-no-changes`
