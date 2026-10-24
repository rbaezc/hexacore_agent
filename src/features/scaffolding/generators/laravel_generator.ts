import { SliceBlueprint, SliceNames } from '../domain/scaffold_types.js';

/** Laravel: self-contained feature folder under app/Features (PSR-4 `App\` → `app/`). */
export function laravelBlueprint(n: SliceNames): SliceBlueprint {
  const ns = `App\\Features\\${n.pascal}`;
  const base = `app/Features/${n.pascal}`;
  return {
    layers: {
      domain: [
        {
          path: `${base}/Domain/${n.pascal}Data.php`,
          role: 'domain',
          content: `<?php

declare(strict_types=1);

namespace ${ns}\\Domain;

final class ${n.pascal}Data
{
    public function __construct(
        public readonly string $id,
        public readonly string $createdAt,
    ) {
    }
}
`,
        },
        {
          path: `${base}/Domain/${n.pascal}Repository.php`,
          role: 'domain',
          content: `<?php

declare(strict_types=1);

namespace ${ns}\\Domain;

/** Port implemented by the infrastructure layer. */
interface ${n.pascal}Repository
{
    public function save(${n.pascal}Data $data): void;

    public function findById(string $id): ?${n.pascal}Data;
}
`,
        },
      ],
      application: [
        {
          path: `${base}/Application/Create${n.pascal}Action.php`,
          role: 'application',
          content: `<?php

declare(strict_types=1);

namespace ${ns}\\Application;

use ${ns}\\Domain\\${n.pascal}Data;
use ${ns}\\Domain\\${n.pascal}Repository;

final class Create${n.pascal}Action
{
    public function __construct(private readonly ${n.pascal}Repository $repository)
    {
    }

    public function execute(string $id): ${n.pascal}Data
    {
        if ($id === '') {
            throw new \\InvalidArgumentException('${n.pascal}: "id" is required.');
        }

        $data = new ${n.pascal}Data($id, (new \\DateTimeImmutable())->format(DATE_ATOM));
        $this->repository->save($data);

        return $data;
    }
}
`,
        },
      ],
      infrastructure: [
        {
          path: `${base}/Infrastructure/InMemory${n.pascal}Repository.php`,
          role: 'infrastructure',
          content: `<?php

declare(strict_types=1);

namespace ${ns}\\Infrastructure;

use ${ns}\\Domain\\${n.pascal}Data;
use ${ns}\\Domain\\${n.pascal}Repository;

final class InMemory${n.pascal}Repository implements ${n.pascal}Repository
{
    /** @var array<string, ${n.pascal}Data> */
    private array $store = [];

    public function save(${n.pascal}Data $data): void
    {
        $this->store[$data->id] = $data;
    }

    public function findById(string $id): ?${n.pascal}Data
    {
        return $this->store[$id] ?? null;
    }
}
`,
        },
      ],
      presentation: [
        {
          path: `${base}/Presentation/${n.pascal}Controller.php`,
          role: 'presentation',
          content: `<?php

declare(strict_types=1);

namespace ${ns}\\Presentation;

use ${ns}\\Application\\Create${n.pascal}Action;
use Illuminate\\Http\\JsonResponse;
use Illuminate\\Http\\Request;

final class ${n.pascal}Controller
{
    public function __construct(private readonly Create${n.pascal}Action $action)
    {
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->action->execute((string) $request->input('id', ''));

        return new JsonResponse($data, 201);
    }
}
`,
        },
      ],
    },
    module: [
      {
        path: `${base}/${n.pascal}ServiceProvider.php`,
        role: 'module',
        content: `<?php

declare(strict_types=1);

namespace ${ns};

use ${ns}\\Domain\\${n.pascal}Repository;
use ${ns}\\Infrastructure\\InMemory${n.pascal}Repository;
use Illuminate\\Support\\ServiceProvider;

/** Composition root of the ${n.pascal} slice; register it in bootstrap/providers.php. */
final class ${n.pascal}ServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(${n.pascal}Repository::class, InMemory${n.pascal}Repository::class);
    }
}
`,
      },
    ],
    tests: [
      {
        path: `tests/Unit/Features/${n.pascal}/Create${n.pascal}ActionTest.php`,
        role: 'test',
        content: `<?php

declare(strict_types=1);

namespace Tests\\Unit\\Features\\${n.pascal};

use ${ns}\\Application\\Create${n.pascal}Action;
use ${ns}\\Infrastructure\\InMemory${n.pascal}Repository;
use PHPUnit\\Framework\\TestCase;

final class Create${n.pascal}ActionTest extends TestCase
{
    public function test_it_creates_and_stores_a_${n.snake}(): void
    {
        $repository = new InMemory${n.pascal}Repository();
        $data = (new Create${n.pascal}Action($repository))->execute('${n.kebab}-1');

        $this->assertSame($data, $repository->findById('${n.kebab}-1'));
    }

    public function test_it_rejects_a_missing_id(): void
    {
        $this->expectException(\\InvalidArgumentException::class);
        (new Create${n.pascal}Action(new InMemory${n.pascal}Repository()))->execute('');
    }
}
`,
      },
    ],
    notes: [],
  };
}
