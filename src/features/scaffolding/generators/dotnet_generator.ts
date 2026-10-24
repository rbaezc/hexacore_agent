import { ProjectProfile, SliceBlueprint, SliceNames } from '../domain/scaffold_types.js';

function join(dir: string, rest: string): string {
  return dir ? `${dir}/${rest}` : rest;
}

export function dotnetBlueprint(n: SliceNames, p: ProjectProfile): SliceBlueprint {
  const ns = `${p.dotnetNamespace}.Features.${n.pascal}`;
  const base = join(p.dotnetProjectDir, `Features/${n.pascal}`);

  const blueprint: SliceBlueprint = {
    layers: {
      domain: [
        {
          path: `${base}/Domain/${n.pascal}Entity.cs`,
          role: 'domain',
          content: `namespace ${ns}.Domain;

public class ${n.pascal}Entity
{
    public string Id { get; init; } = string.Empty;
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>Port implemented by the infrastructure layer.</summary>
public interface I${n.pascal}Repository
{
    Task SaveAsync(${n.pascal}Entity entity);
    Task<${n.pascal}Entity?> FindByIdAsync(string id);
}
`,
        },
      ],
      application: [
        {
          path: `${base}/Application/Create${n.pascal}Handler.cs`,
          role: 'application',
          content: `using ${ns}.Domain;

namespace ${ns}.Application;

public record Create${n.pascal}Command(string Id);

public class Create${n.pascal}Handler
{
    private readonly I${n.pascal}Repository _repository;

    public Create${n.pascal}Handler(I${n.pascal}Repository repository)
    {
        _repository = repository;
    }

    public async Task<${n.pascal}Entity> HandleAsync(Create${n.pascal}Command command)
    {
        if (string.IsNullOrWhiteSpace(command.Id))
        {
            throw new ArgumentException("${n.pascal}: \\"Id\\" is required.", nameof(command));
        }

        var now = DateTime.UtcNow;
        var entity = new ${n.pascal}Entity { Id = command.Id, CreatedAt = now, UpdatedAt = now };
        await _repository.SaveAsync(entity);
        return entity;
    }

    public Task<${n.pascal}Entity?> GetByIdAsync(string id) => _repository.FindByIdAsync(id);
}
`,
        },
      ],
      infrastructure: [
        {
          path: `${base}/Infrastructure/InMemory${n.pascal}Repository.cs`,
          role: 'infrastructure',
          content: `using System.Collections.Concurrent;
using ${ns}.Domain;

namespace ${ns}.Infrastructure;

public class InMemory${n.pascal}Repository : I${n.pascal}Repository
{
    private readonly ConcurrentDictionary<string, ${n.pascal}Entity> _store = new();

    public Task SaveAsync(${n.pascal}Entity entity)
    {
        _store[entity.Id] = entity;
        return Task.CompletedTask;
    }

    public Task<${n.pascal}Entity?> FindByIdAsync(string id)
    {
        _store.TryGetValue(id, out var entity);
        return Task.FromResult(entity);
    }
}
`,
        },
      ],
      presentation: [
        {
          path: `${base}/Presentation/${n.pascal}Controller.cs`,
          role: 'presentation',
          content: `using Microsoft.AspNetCore.Mvc;
using ${ns}.Application;
using ${ns}.Domain;

namespace ${ns}.Presentation;

[ApiController]
[Route("api/${n.kebab}")]
public class ${n.pascal}Controller : ControllerBase
{
    private readonly Create${n.pascal}Handler _handler;

    public ${n.pascal}Controller(Create${n.pascal}Handler handler)
    {
        _handler = handler;
    }

    [HttpPost]
    public async Task<ActionResult<${n.pascal}Entity>> Create(Create${n.pascal}Command command)
    {
        var entity = await _handler.HandleAsync(command);
        return CreatedAtAction(nameof(GetById), new { id = entity.Id }, entity);
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<${n.pascal}Entity>> GetById(string id)
    {
        var entity = await _handler.GetByIdAsync(id);
        return entity is null ? NotFound() : Ok(entity);
    }
}
`,
        },
      ],
    },
    module: [
      {
        path: `${base}/${n.pascal}Module.cs`,
        role: 'module',
        content: `using Microsoft.Extensions.DependencyInjection;
using ${ns}.Application;
using ${ns}.Domain;
using ${ns}.Infrastructure;

namespace ${ns};

/// <summary>Composition root of the ${n.pascal} slice. Call <c>services.Add${n.pascal}Feature()</c> in Program.cs.</summary>
public static class ${n.pascal}Module
{
    public static IServiceCollection Add${n.pascal}Feature(this IServiceCollection services)
    {
        services.AddSingleton<I${n.pascal}Repository, InMemory${n.pascal}Repository>();
        services.AddScoped<Create${n.pascal}Handler>();
        return services;
    }
}
`,
      },
    ],
    tests: [],
    notes: [],
  };

  if (p.dotnetTestProjectDir !== undefined) {
    const testNs = `${p.dotnetTestNamespace}.Features.${n.pascal}`;
    blueprint.tests.push({
      path: join(p.dotnetTestProjectDir, `Features/${n.pascal}/Create${n.pascal}HandlerTests.cs`),
      role: 'test',
      content: `using ${ns}.Application;
using ${ns}.Infrastructure;
using Xunit;

namespace ${testNs};

public class Create${n.pascal}HandlerTests
{
    [Fact]
    public async Task CreatesAndRetrieves${n.pascal}()
    {
        var handler = new Create${n.pascal}Handler(new InMemory${n.pascal}Repository());
        var created = await handler.HandleAsync(new Create${n.pascal}Command("${n.kebab}-1"));
        Assert.Equal(created, await handler.GetByIdAsync("${n.kebab}-1"));
    }

    [Fact]
    public async Task RejectsMissingId()
    {
        var handler = new Create${n.pascal}Handler(new InMemory${n.pascal}Repository());
        await Assert.ThrowsAsync<ArgumentException>(() => handler.HandleAsync(new Create${n.pascal}Command("")));
    }
}
`,
    });
  } else {
    blueprint.notes.push('No xUnit test project found (a .csproj referencing xunit); slice tests were not generated.');
  }
  return blueprint;
}
